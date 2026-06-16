import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { TelegramAdapter } from "./adapters/telegram";
import { WhatsAppAdapter } from "./adapters/whatsapp";
import { WhatsAppBaileysAdapter } from "./adapters/whatsapp-baileys";
import { XAdapter } from "./adapters/x";
import { XApiAdapter } from "./adapters/x-api";
import { persistInbound, persistRead, prisma } from "./store";
import {
  ensureAndBackfill,
  listRunnableAccounts,
  type RunnableAccount,
} from "./accounts";
import type { Adapter, InboundMessage } from "./adapters/types";

// One adapter instance per connected account, keyed by accountId.
const adapters = new Map<string, Adapter>();
const accountMeta = new Map<string, { platform: string; label: string | null }>();

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function safeJson(s: string): { authToken: string; ct0: string } | undefined {
  try {
    const j = JSON.parse(s);
    if (j.authToken && j.ct0) return j;
  } catch {
    /* not json */
  }
  return undefined;
}

// Heavy = a real browser (whatsapp-web.js or the XChat browser). Light = the
// browser-free drivers (telegram MTProto, baileys, x-api).
function isHeavy(acc: RunnableAccount): boolean {
  return (
    (acc.platform === "whatsapp" && acc.driver !== "baileys") ||
    (acc.platform === "x" && acc.driver !== "api")
  );
}

function buildAdapter(acc: RunnableAccount): Adapter | null {
  if (acc.platform === "telegram") {
    const { TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION } = process.env;
    const session = acc.session || TELEGRAM_SESSION;
    if (!TELEGRAM_API_ID || !TELEGRAM_API_HASH || !session) {
      console.log("[sync] telegram account skipped — missing api id/hash/session");
      return null;
    }
    return new TelegramAdapter(Number(TELEGRAM_API_ID), TELEGRAM_API_HASH, session);
  }
  if (acc.platform === "whatsapp") {
    // Per-account session dir via clientId so multiple numbers don't collide.
    return acc.driver === "baileys"
      ? new WhatsAppBaileysAdapter({ clientId: acc.id })
      : new WhatsAppAdapter();
  }
  if (acc.platform === "x") {
    if (acc.driver === "api") {
      const auth = acc.session ? safeJson(acc.session) : undefined;
      return new XApiAdapter(auth ? { auth } : {});
    }
    return new XAdapter();
  }
  return null;
}

async function startAdapters() {
  // Bridge env → Account rows and backfill conversation.accountId before any
  // adapter runs (so new messages never create null-account duplicates).
  await ensureAndBackfill();
  const accounts = await listRunnableAccounts();
  if (!accounts.length) {
    console.log(
      "[sync] no accounts to run — enable a platform in .env (TELEGRAM_*/WHATSAPP_ENABLED/X_ENABLED)."
    );
    return;
  }

  // Light adapters first; stagger heavy browser ones so two Chrome SPAs don't
  // starve each other at boot.
  const ordered = [...accounts].sort(
    (a, b) => Number(isHeavy(a)) - Number(isHeavy(b))
  );
  for (const acc of ordered) {
    try {
      const adapter = buildAdapter(acc);
      if (!adapter) continue;
      adapters.set(acc.id, adapter);
      accountMeta.set(acc.id, { platform: acc.platform, label: acc.label });
      // Inject this account's id into every inbound message + read event.
      const onMessage = (m: InboundMessage) =>
        persistInbound({ ...m, accountId: acc.id });
      const onRead = (chatId: string) => persistRead(acc.id, chatId);
      adapter
        .start(onMessage, onRead)
        .catch((e) =>
          console.error(`[${acc.platform}:${acc.label || acc.id}] start error:`, e)
        );
      console.log(
        `[sync] started ${acc.platform} (${acc.driver || "default"}) — ${acc.label || acc.id}`
      );
      if (isHeavy(acc)) await delay(Number(process.env.HEAVY_START_GAP_MS || 8000));
    } catch (e) {
      console.error(`[sync] failed to start ${acc.platform} ${acc.label || acc.id}:`, e);
    }
  }
}

// Resolve the adapter for an outbound action: prefer the explicit accountId,
// else the first adapter on that platform (back-compat with the single-account
// web that only sends a platform).
function resolveAdapter(body: {
  accountId?: string;
  platform?: string;
}): Adapter | undefined {
  if (body.accountId && adapters.has(body.accountId))
    return adapters.get(body.accountId);
  if (body.platform) {
    for (const [id, meta] of accountMeta)
      if (meta.platform === body.platform) return adapters.get(id);
  }
  return undefined;
}

function startControlServer() {
  const port = Number(process.env.SYNC_CONTROL_PORT || 4001);
  http
    .createServer((req, res) => {
      if (req.method === "POST" && req.url === "/send") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            const { platform, accountId, chatExternalId, text, media } =
              JSON.parse(body);
            const adapter = resolveAdapter({ accountId, platform });
            if (!adapter) {
              res.writeHead(400, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({
                  error: `no running adapter for account '${accountId || platform}'`,
                })
              );
            }
            const outMedia = media
              ? {
                  type: media.type,
                  name: media.name,
                  path: path.join(
                    process.cwd(),
                    "public",
                    String(media.url).replace(/^\//, "")
                  ),
                }
              : undefined;
            const sent = await adapter.send(chatExternalId, text, outMedia);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(sent));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/read") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            const { platform, accountId, chatExternalId } = JSON.parse(body);
            const adapter = resolveAdapter({ accountId, platform });
            if (adapter?.markRead) await adapter.markRead(chatExternalId);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
        return;
      }
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({ ok: true, accounts: [...adapters.keys()] })
        );
      }
      if (req.method === "GET" && req.url === "/status") {
        // Per-platform aggregate (back-compat with the current Connections UI),
        // plus a per-account list for the multi-account UI.
        const status: Record<string, unknown> = {};
        for (const p of ["telegram", "whatsapp", "x"])
          status[p] = { platform: p, state: "disabled" };
        const accounts: unknown[] = [];
        for (const [id, adapter] of adapters) {
          const meta = accountMeta.get(id);
          const s = adapter.getStatus();
          if (meta) status[meta.platform] = s;
          accounts.push({ accountId: id, label: meta?.label, ...s });
        }
        status.accounts = accounts;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(status));
      }
      res.writeHead(404);
      res.end();
    })
    .listen(port, () => console.log(`[sync] control server on :${port}`));
}

// Fire recurring (scheduled) automations when they're due. The web app holds
// the engine, so we just trigger its /run endpoint for each due automation.
function startAutomationScheduler() {
  const webUrl =
    process.env.WEB_URL || `http://localhost:${process.env.PORT || 3000}`;
  const tick = async () => {
    try {
      const autos = await prisma.automation.findMany({
        where: { enabled: true, schedule: { not: "manual" } },
      });
      const now = Date.now();
      for (const a of autos) {
        const last = a.lastRunAt ? a.lastRunAt.getTime() : 0;
        const intervalMs =
          a.schedule === "daily"
            ? 86_400_000
            : (a.everyNDays || 1) * 86_400_000;
        if (now - last < intervalMs) continue;
        console.log(`[automations] running "${a.name}"`);
        await fetch(`${webUrl}/api/automations/${a.id}/run`, {
          method: "POST",
        }).catch((e) => console.error("[automations] run error:", e));
      }
    } catch (e) {
      console.error("[automations] scheduler error:", e);
    }
  };
  setInterval(tick, 5 * 60 * 1000); // check every 5 minutes
  console.log("[automations] scheduler started");
}

async function main() {
  startControlServer();
  startAutomationScheduler();
  try {
    await startAdapters();
  } catch (e) {
    console.error("[sync] startAdapters error (continuing):", e);
  }
}

main().catch((e) => console.error("[sync] error:", e));
