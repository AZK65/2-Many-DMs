import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { acquireWorkerLock } from "../../sync/worker-lock";
import { agentAccessStore } from "./mcp-access";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const clientSchema = z.object({
  id: z.string(),
  name: z.string(),
  redirects: z.array(z.string()),
  expires: z.number(),
});
const codeSchema = z.object({
  client: z.string(),
  key: z.string(),
  redirect: z.string(),
  challenge: z.string(),
  resource: z.string(),
  expires: z.number(),
});
const grantSchema = z.object({
  client: z.string(),
  key: z.string(),
  resource: z.string(),
  access: z.string(),
  accessExpires: z.number(),
  refresh: z.string(),
  expires: z.number(),
});
const stateSchema = z.object({
  clients: z.array(clientSchema),
  codes: z.record(z.string(), codeSchema),
  grants: z.array(grantSchema),
});
type State = z.infer<typeof stateSchema>;
const month = 30 * 24 * 60 * 60 * 1000;
export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const invalid = () =>
  new OAuthError(
    "invalid_grant",
    "This authorization is invalid or expired. Connect again.",
  );

export function mcpResource(request: Request) {
  if (process.env.MCP_PUBLIC_URL) {
    const url = new URL(process.env.MCP_PUBLIC_URL);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/api/mcp" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error("Invalid MCP public address");
    return url.href;
  }
  const host = request.headers.get("host") || "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
    throw new Error("No MCP address configured");
  return `http://${host}/api/mcp`;
}

export function oauthStore(
  root = process.env.DATA_DIR || process.cwd(),
  now = Date.now,
) {
  const directory = path.join(root, ".local", "mcp", "oauth");
  const filename = path.join(directory, "state.json");
  const access = agentAccessStore(root);
  function read(): State {
    try {
      return stateSchema.parse(JSON.parse(fs.readFileSync(filename, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { clients: [], codes: {}, grants: [] };
      throw new Error("OAuth access is temporarily unavailable");
    }
  }
  function change<T>(run: (state: State) => T): T {
    const lock = acquireWorkerLock(directory);
    const temp = `${filename}.${randomUUID()}.tmp`;
    try {
      const state = read();
      state.clients = state.clients.filter((client) => client.expires > now());
      state.codes = Object.fromEntries(
        Object.entries(state.codes).filter(([, code]) => code.expires > now()),
      );
      state.grants = state.grants.filter((grant) => grant.expires > now());
      const result = run(state);
      fs.writeFileSync(temp, JSON.stringify(state), {
        mode: 0o600,
        flag: "wx",
      });
      fs.renameSync(temp, filename);
      return result;
    } finally {
      try {
        fs.rmSync(temp, { force: true });
      } finally {
        lock.release();
      }
    }
  }
  function consent(
    input: Record<string, string>,
    resource: string,
    state = read(),
  ) {
    const client = state.clients.find(
      (client) => client.id === input.client_id && client.expires > now(),
    );
    if (!client || !client.redirects.includes(input.redirect_uri))
      throw new OAuthError(
        "invalid_request",
        "Unrecognized agent or return address.",
      );
    if (
      input.response_type !== "code" ||
      input.code_challenge_method !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge || "") ||
      (input.scope && input.scope !== "chats:read") ||
      (input.resource && input.resource !== resource) ||
      (input.state || "").length > 2048
    )
      throw new OAuthError(
        "invalid_request",
        "This agent must request read-only access with PKCE and the correct server address.",
      );
    return client;
  }
  function issue(state: State, client: string, key: string, resource: string) {
    if (state.grants.length >= 128)
      throw new OAuthError(
        "temporarily_unavailable",
        "Too many active authorizations. Revoke an unused agent key.",
      );
    const accessToken = `tmd_oauth_${secret()}`;
    const refreshToken = `tmd_refresh_${secret()}`;
    state.grants.push({
      client,
      key,
      resource,
      access: digest(accessToken),
      accessExpires: now() + 15 * 60_000,
      refresh: digest(refreshToken),
      expires: now() + month,
    });
    const registered = state.clients.find((item) => item.id === client);
    if (registered) registered.expires = now() + month;
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 900,
      refresh_token: refreshToken,
      scope: "chats:read",
    };
  }
  return {
    register(input: unknown) {
      const parsed = z
        .object({
          client_name: z.string().trim().max(80).default("MCP agent"),
          redirect_uris: z.array(z.string().url().max(2048)).min(1).max(5),
          token_endpoint_auth_method: z.literal("none").optional(),
          grant_types: z
            .array(z.enum(["authorization_code", "refresh_token"]))
            .optional(),
          response_types: z.array(z.literal("code")).optional(),
        })
        .parse(input);
      for (const uri of parsed.redirect_uris) {
        const u = new URL(uri);
        if (
          u.hash ||
          u.username ||
          u.password ||
          (u.protocol !== "https:" &&
            !(
              u.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
            ))
        )
          throw new OAuthError(
            "invalid_redirect_uri",
            "Use an HTTPS or loopback return address.",
          );
      }
      return change((state) => {
        let client = state.clients.find(
          (client) =>
            client.name === parsed.client_name &&
            JSON.stringify(client.redirects) ===
              JSON.stringify(parsed.redirect_uris),
        );
        if (!client) {
          if (state.clients.length >= 128) {
            const activeClients = new Set([
              ...state.grants.map((grant) => grant.client),
              ...Object.values(state.codes).map((code) => code.client),
            ]);
            const unused = state.clients.findIndex(
              (client) => !activeClients.has(client.id),
            );
            if (unused >= 0) state.clients.splice(unused, 1);
          }
          if (state.clients.length >= 128)
            throw new OAuthError(
              "temporarily_unavailable",
              "Registration capacity reached. Try again later.",
              429,
            );
          client = {
            id: randomUUID(),
            name: parsed.client_name,
            redirects: parsed.redirect_uris,
            expires: now() + 20 * 60_000,
          };
          state.clients.push(client);
        }
        return {
          client_id: client.id,
          client_name: client.name,
          redirect_uris: client.redirects,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        };
      });
    },
    describe(input: Record<string, string>, resource: string) {
      const client = consent(input, resource);
      return {
        clientName: client.name,
        redirectOrigin: new URL(input.redirect_uri).origin,
      };
    },
    approve(input: Record<string, string>, token: string, resource: string) {
      const key = access.authenticate(`Bearer ${token}`);
      if (!key)
        throw new OAuthError(
          "access_denied",
          "That agent key is invalid or revoked. Create a key in Settings → Integrations.",
          401,
        );
      return change((state) => {
        const client = consent(input, resource, state);
        if (Object.keys(state.codes).length >= 128)
          throw new OAuthError(
            "temporarily_unavailable",
            "Too many pending connections. Try again in five minutes.",
            429,
          );
        const code = secret();
        state.codes[digest(code)] = {
          client: client.id,
          key: key.id,
          redirect: input.redirect_uri,
          challenge: input.code_challenge,
          resource,
          expires: now() + 5 * 60_000,
        };
        const redirect = new URL(input.redirect_uri);
        redirect.searchParams.set("code", code);
        if (input.state) redirect.searchParams.set("state", input.state);
        redirect.searchParams.set("iss", new URL(resource).origin);
        return { redirect: redirect.href };
      });
    },
    exchange(input: Record<string, string>, resource: string) {
      if (input.resource && input.resource !== resource) throw invalid();
      return change((state) => {
        const keys = new Set(access.list().map((key) => key.id));
        state.grants = state.grants.filter((grant) => keys.has(grant.key));
        if (input.grant_type === "authorization_code") {
          const hash = digest(input.code || "");
          const code = state.codes[hash];
          if (
            !code ||
            code.client !== input.client_id ||
            code.redirect !== input.redirect_uri ||
            code.resource !== resource ||
            !keys.has(code.key) ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier || "") ||
            createHash("sha256")
              .update(input.code_verifier)
              .digest("base64url") !== code.challenge
          )
            throw invalid();
          delete state.codes[hash];
          return issue(state, code.client, code.key, resource);
        }
        if (input.grant_type === "refresh_token") {
          const grant = state.grants.find(
            (grant) =>
              grant.refresh === digest(input.refresh_token || "") &&
              grant.client === input.client_id &&
              grant.resource === resource,
          );
          if (!grant) throw invalid();
          state.grants = state.grants.filter((item) => item !== grant);
          return issue(state, grant.client, grant.key, resource);
        }
        throw new OAuthError(
          "unsupported_grant_type",
          "Use an authorization code or refresh token.",
        );
      });
    },
    authenticate(header: string | null, resource: string) {
      const match = /^Bearer (tmd_oauth_[A-Za-z0-9_-]{43})$/.exec(header || "");
      if (!match) return null;
      const grant = read().grants.find(
        (grant) =>
          grant.access === digest(match[1]) &&
          grant.resource === resource &&
          grant.accessExpires > now() &&
          grant.expires > now(),
      );
      if (!grant) return null;
      return access.list().find((key) => key.id === grant.key) || null;
    },
    revoke(token: string, client: string) {
      change((state) => {
        const value = digest(token);
        state.grants = state.grants.filter(
          (grant) =>
            grant.client !== client ||
            (grant.access !== value && grant.refresh !== value),
        );
      });
    },
  };
}
