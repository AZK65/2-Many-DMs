import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { TelegramAdapter } from "./adapters/telegram";
import { WhatsAppAdapter } from "./adapters/whatsapp";
import { WhatsAppBaileysAdapter } from "./adapters/whatsapp-baileys";
import { XAdapter } from "./adapters/x";
import { XApiAdapter } from "./adapters/x-api";
import { GmailAdapter } from "./adapters/gmail";
import { DiscordBotAdapter } from "./adapters/discord";
import { DiscordSearchAdapter } from "./adapters/discord-search";
import { persistInbound, persistReaction, persistRead, prisma, prismaReady, repairWhatsAppIdentities } from "./store";
import {
  ensureAndBackfill,
  listRunnableAccounts,
  type RunnableAccount,
} from "./accounts";
import type {
  Adapter,
  InboundMessage,
  InboundReaction,
  OutboundMedia,
  OutboundSendContext,
  SentMessage,
} from "./adapters/types";

import { startOcrIndexer } from "./ocr";
import { ConnectorOperations } from "./connector-operations";
import { acquireWorkerLocks } from "./worker-lock";
import { recordDeliveryReceipt } from "./delivery-receipt";
import { MessageRetention, canonicalWhatsAppMessage } from "./retention";
import fs from "node:fs";
import { AvatarBackfill } from "./avatar-backfill";
import { avatarContactWhere, collectAvatarJobs } from "./avatar-targets";
import { directRecipientIds } from "../src/lib/direct-contact-identity";
import { resolveTelegramSession } from "../src/lib/telegram-session";
import { createHash } from "node:crypto";

// One adapter instance per connected account, keyed by accountId.
const adapters = new Map<string, Adapter>();
const accountMeta = new Map<string, { platform: string; label: string | null }>();
const accountVersions = new Map<string, string>();
const connectorOperations = new ConnectorOperations<Adapter>();
let adapterReload: Promise<void> | undefined;
let controlServer: http.Server | undefined;
let recoveryTimer: ReturnType<typeof setInterval> | undefined;
let initialized = false;
let retention: MessageRetention;
let retentionTimer: ReturnType<typeof setInterval> | undefined;
let avatarBackfill: AvatarBackfill;
let avatarTimer: ReturnType<typeof setInterval> | undefined;
let releaseWorkerLocks: (() => void) | undefined;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class OperationTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} did not finish within ${Math.ceil(timeoutMs / 1000)} seconds`);
    this.name = "OperationTimeoutError";
  }
}

function withDeadline<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OperationTimeoutError(label, timeoutMs)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([operation, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const sendOperations = new Map<string, Promise<SentMessage>>();

function isUncertainSendError(error: unknown): boolean {
  const message = String(error);
  // These failures happen before the platform's Send action. They are safe to
  // label as not sent even when the underlying browser error says "timeout".
  if (
    /(?:finding composer|preparing message|attaching media|typing message|waiting for Send button) failed/i.test(
      message
    ) ||
    /(?:composer|file input) not found/i.test(message)
  )
    return false;
  // Once X's trusted Send click has happened, any later exception is an
  // uncertain confirmation result—not proof that delivery failed.
  if (/waiting for X acceptance failed/i.test(message)) return true;
  if (error instanceof OperationTimeoutError) return true;
  return /timeout|timed out|enet|econn|fetch failed|socket|not connected|connection closed|disconnected|network|detached frame|target closed/i.test(
    message
  );
}

async function markDeliverySent(
  pendingMessageId: string,
  sent: SentMessage,
  acceptedXRequest = false
): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: pendingMessageId },
    select: { conversationId: true },
  });
  if (!message) return;
  const timestamp = new Date(sent.timestamp);
  try {
    await recordDeliveryReceipt(prisma, pendingMessageId, sent);
  } catch (error) {
    // The platform echo may win the race before the adapter returns its id.
    // If it already created a separate sent row, fold that row back into the
    // optimistic client row instead of turning the optimistic copy red.
    const current = await prisma.message.findUnique({
      where: { id: pendingMessageId },
      select: { externalKey: true, deliveryStatus: true },
    });
    if (
      current?.externalKey === sent.messageExternalId &&
      current.deliveryStatus === "sent"
    ) {
      // The echo reconciler already completed the optimistic row.
    } else {
      const echoed = await prisma.message.findUnique({
        where: { externalKey: sent.messageExternalId },
        select: { id: true, conversationId: true, direction: true, createdAt: true },
      });
      if (
        echoed &&
        echoed.id !== pendingMessageId &&
        echoed.conversationId === message.conversationId &&
        echoed.direction === "out" &&
        current
      ) {
        await prisma.$transaction([
          prisma.message.delete({ where: { id: echoed.id } }),
          prisma.message.update({
            where: { id: pendingMessageId },
            data: {
              externalKey: sent.messageExternalId,
              createdAt: echoed.createdAt,
              deliveryStatus: "sent",
              deliveryError: null,
            },
          }),
        ]);
      } else if (!echoed || current) {
        throw error;
      }
      // If the optimistic row was already removed but the echo exists, the
      // durable sent message is complete and there is nothing left to merge.
    }
  }
  await prisma.conversation.update({
    where: { id: message.conversationId },
    data: {
      lastMessageAt: timestamp,
      unread: 0,
      hasUnreadMention: false,
      status: "open",
      ...(acceptedXRequest ? { inboxCategory: "general" } : {}),
      snoozedUntil: null,
      followUpAt: null,
    },
  }).catch((error) =>
    console.error("[sync] sent message but conversation summary update failed:", error)
  );
}

async function markDeliveryProblem(
  pendingMessageId: string,
  error: unknown
): Promise<void> {
  const uncertain = isUncertainSendError(error);
  const detail = String(error).replace(/^Error:\s*/, "");
  const knownNotSent = !uncertain &&
    /(?:finding composer|preparing message|attaching media|typing message|waiting for Send button) failed|(?:composer|file input) not found/i.test(
      detail
    );
  await prisma.message.updateMany({
    where: {
      id: pendingMessageId,
      deliveryStatus: { in: ["pending", "unconfirmed"] },
    },
    data: {
      deliveryStatus: uncertain ? "unconfirmed" : "failed",
      deliveryError: uncertain
        ? "The platform did not confirm delivery. Check the native app before retrying."
        : knownNotSent
          ? "The message could not be prepared. Nothing was sent."
          : detail.slice(0, 500),
    },
  });
}

function trackedSend(
  pendingMessageId: string | undefined,
  adapter: Adapter,
  chatExternalId: string,
  body: string,
  media?: OutboundMedia,
  mentions?: string[],
  replyToExternalId?: string,
  context?: OutboundSendContext
): Promise<SentMessage> {
  if (pendingMessageId) {
    const existing = sendOperations.get(pendingMessageId);
    if (existing) return existing;
  }
  const operation = connectorOperations
    .send(adapter, () => adapter.send(chatExternalId, body, media, mentions, replyToExternalId, context))
    .then(async (sent) => {
      if (pendingMessageId) {
        await markDeliverySent(
          pendingMessageId,
          sent,
          adapter.platform === "x" && context?.inboxCategory === "spam"
        );
        if (sent.messageExternalId.includes(":pending:")) {
          const provisionalKey = sent.messageExternalId;
          const echoTimeoutMs = Math.max(
            45_000,
            Number(
              adapter.platform === "x"
                ? process.env.X_DELIVERY_ECHO_TIMEOUT_MS || 90_000
                : process.env.WHATSAPP_DELIVERY_ECHO_TIMEOUT_MS || 45_000
            )
          );
          const echoWatchdog = setTimeout(() => {
            void prisma.message.updateMany({
              where: {
                id: pendingMessageId,
                externalKey: provisionalKey,
                deliveryStatus: "sent",
              },
              data: {
                deliveryStatus: "unconfirmed",
                deliveryError:
                  `${adapter.platform === "x" ? "X" : "WhatsApp"} accepted the send, but did not return its final message confirmation. Check the native app before retrying.`,
              },
            }).catch((error) =>
              console.error(
                `[${adapter.platform}] delivery echo watchdog failed:`,
                error
              )
            );
          }, echoTimeoutMs);
          echoWatchdog.unref?.();
        }
      }
      return sent;
    })
    .catch(async (error) => {
      if (pendingMessageId) await markDeliveryProblem(pendingMessageId, error);
      throw error;
    });
  // Async acknowledgement returns before delivery completes. Always observe
  // the rejection, even when there is no HTTP caller awaiting confirmation.
  void operation.catch((error) =>
    console.error(`[${adapter.platform}] send failed:`, error)
  );
  if (pendingMessageId) {
    const confirmationWatchdog = setTimeout(() => {
      void prisma.message.updateMany({
        where: { id: pendingMessageId, deliveryStatus: "pending" },
        data: {
          deliveryStatus: "unconfirmed",
          deliveryError:
            "The platform did not confirm delivery. Check the native app before retrying.",
        },
      }).catch((error) =>
        console.error("[sync] delivery confirmation watchdog failed:", error)
      );
    }, 45_000);
    confirmationWatchdog.unref?.();
    void operation.then(
      () => clearTimeout(confirmationWatchdog),
      () => clearTimeout(confirmationWatchdog)
    );
    sendOperations.set(pendingMessageId, operation);
    void operation.then(
      () => setTimeout(() => sendOperations.delete(pendingMessageId), 5 * 60 * 1000).unref?.(),
      () => setTimeout(() => sendOperations.delete(pendingMessageId), 5 * 60 * 1000).unref?.()
    );
  }
  return operation;
}

function safeJson(s: string): { authToken: string; ct0: string; passcode?: string } | undefined {
  try {
    const j = JSON.parse(s);
    if (j.authToken && j.ct0) return j;
  } catch {
    /* not json */
  }
  return undefined;
}

// Heavy = a real browser (whatsapp-web.js or the XChat browser). Light = the
// browser-free drivers (telegram MTProto, baileys and x-api).
function isHeavy(acc: RunnableAccount): boolean {
  return (
    (acc.platform === "whatsapp" && acc.driver !== "baileys") ||
    (acc.platform === "x" && acc.driver !== "api")
  );
}

function buildAdapter(acc: RunnableAccount): Adapter | null {
  if (acc.platform === "telegram") {
    const credentials = resolveTelegramSession(acc.session);
    if (!credentials) {
      console.log("[sync] telegram account skipped — missing api id/hash/session");
      return null;
    }
    return new TelegramAdapter(credentials.apiId, credentials.apiHash, credentials.session, acc.id);
  }
  if (acc.platform === "whatsapp") {
    // Per-account session dir via clientId so multiple numbers don't collide.
    return acc.driver === "baileys"
      ? new WhatsAppBaileysAdapter({ clientId: acc.id })
      : new WhatsAppAdapter({ clientId: acc.label === "default" ? undefined : acc.id, onIdentities: (identities) => repairWhatsAppIdentities(acc.id, identities) });
  }
  if (acc.platform === "x") {
    if (acc.driver === "api") {
      const auth = acc.session ? safeJson(acc.session) : undefined;
      return new XApiAdapter(auth ? { auth } : {});
    }
    return new XAdapter({ accountId: acc.id, session: acc.session ? safeJson(acc.session) : undefined });
  }
  if (acc.platform === "discord") {
    if (acc.driver === "personal-readonly" && acc.session) {
      return new DiscordSearchAdapter(JSON.parse(acc.session), acc.id);
    }
    if (acc.driver !== "bot") {
      console.log("[sync] legacy Discord archive skipped — connect an official bot to sync");
      return null;
    }
    const token = acc.session || (acc.label === "default" ? process.env.DISCORD_BOT_TOKEN : undefined);
    if (!token) {
      console.log("[sync] Discord bot skipped — missing bot token");
      return null;
    }
    return new DiscordBotAdapter(token);
  }
  if (acc.platform === "gmail" && acc.session) {
    try { return new GmailAdapter(JSON.parse(acc.session)); }
    catch { console.error("[gmail] invalid stored session"); return null; }
  }
  return null;
}

function startAdapters(): Promise<void> {
  if (adapterReload) return adapterReload;
  initialized = false;
  adapterReload = reconcileAdapters().then(() => { initialized = true; }).finally(() => {
    adapterReload = undefined;
  });
  return adapterReload;
}

async function reconcileAdapters() {
  // Bridge env → Account rows and backfill conversation.accountId before any
  // adapter runs (so new messages never create null-account duplicates).
  await ensureAndBackfill();
  const accounts = await listRunnableAccounts();
  const runnableIds = new Set(accounts.map((account) => account.id));
  // /reload is used after connect/remove. Reconcile removed accounts as well as
  // starting newly added ones so an old bot does not keep syncing in memory.
  for (const [accountId, adapter] of adapters) {
    const updated = accounts.find(account => account.id === accountId);
    const discordSearchChanged = adapter instanceof DiscordSearchAdapter &&
      (updated?.driver !== "personal-readonly" || !adapter.matchesSession(updated.session));
    if (runnableIds.has(accountId) && !discordSearchChanged) continue;
    try {
      await withDeadline(adapter.stop(), 10_000, `${adapter.platform} removal`);
    } catch (error) {
      console.error(`[sync] account removal still stopping (${accountId}):`, error);
      continue;
    }
    adapters.delete(accountId);
    accountMeta.delete(accountId);
    accountVersions.delete(accountId);
  }
  if (!accounts.length) {
    console.log(
      "[sync] no accounts to run — connect an account in the app or enable one in .env."
    );
    return;
  }

  // Light adapters first; stagger heavy browser ones so two Chrome SPAs don't
  // starve each other at boot.
  const ordered = [...accounts].sort(
    (a, b) => Number(isHeavy(a)) - Number(isHeavy(b))
  );
  // Telegram/X without their own stored session fall back to the shared
  // env credentials — running several would duplicate ingestion under different
  // accountIds (and trip AUTH_KEY_DUPLICATED on Telegram). Allow only the first
  // such account per platform; the rest need their own session to run.
  // Also: if a platform already has an account WITH its own stored session, the
  // env-credential fallback is almost certainly the same login — starting both
  // deadlocks Telegram on AUTH_KEY_DUPLICATED and leaves a zombie adapter that
  // hangs every send/group-create routed to it. Skip the env fallback entirely.
  const platformHasOwnSession = new Set(
    ordered.filter((a) => a.session).map((a) => a.platform)
  );
  const envUsed = new Set<string>();
  for (const acc of ordered) {
    if (shuttingDown) return;
    try {
      // startAdapters is also used by /reload after a browser-extension pairing.
      // Never create a second live adapter for an account already running.
      const version = createHash("sha256").update(`${acc.driver}:${acc.session || "env"}`).digest("hex");
      const current = adapters.get(acc.id);
      if (current) {
        if (accountVersions.get(acc.id) === version) continue;
        // A fresh login replaces an invalid session without launching two clients.
        if (!connectorOperations.canRecover(current)) continue;
        await connectorOperations.runLifecycle(current, "recover", () => current.stop());
        adapters.delete(acc.id);
      }
      if (
        (acc.platform === "telegram" || acc.platform === "x") &&
        !acc.session
      ) {
        if (envUsed.has(acc.platform) || platformHasOwnSession.has(acc.platform)) {
          console.warn(
            `[sync] skipping ${acc.platform} "${acc.label || acc.id}" — no stored session (env credentials already in use by a connected account). Connect it to run it.`
          );
          continue;
        }
        envUsed.add(acc.platform);
      }
      const adapter = buildAdapter(acc);
      if (!adapter) continue;
      adapters.set(acc.id, adapter);
      accountVersions.set(acc.id, version);
      accountMeta.set(acc.id, { platform: acc.platform, label: acc.label });
      // Inject this account's id into every inbound message + read event.
      const onMessage = async (m: InboundMessage) => {
        if (shuttingDown || adapters.get(acc.id) !== adapter) return;
        const conversationId = await retention.save(canonicalWhatsAppMessage({ ...m, accountId: acc.id }), persistInbound);
        // Only live inbound messages trigger instant rules. Historical backfill
        // is still imported, but cannot accidentally fire outreach.
        if (
          conversationId &&
          m.inboxCategory !== "spam" &&
          !m.historical &&
          acc.driver !== "personal-readonly" &&
          Date.now() - new Date(m.timestamp).getTime() < 5 * 60 * 1000
        ) {
          const webUrl =
            process.env.WEB_URL || `http://localhost:${process.env.PORT || 3000}`;
          await fetch(`${webUrl}/api/automations/inbound`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId }),
            signal: AbortSignal.timeout(10_000),
          }).catch((e) => console.error("[automations] inbound trigger error:", e));
        }
      };
      const onRead = (chatId: string) => persistRead(acc.id, acc.platform === "whatsapp" ? chatId.replace(/@s\.whatsapp\.net$/, "@c.us") : chatId);
      const onReaction = (r: InboundReaction) =>
        persistReaction({ ...r, accountId: acc.id, ...(r.platform === "whatsapp" ? {
          messageExternalId: r.messageExternalId.replace(/@s\.whatsapp\.net(?=:|$)/g, "@c.us"),
          actor: { ...r.actor, externalKey: r.actor.externalKey.replace(/@s\.whatsapp\.net$/, "@c.us") },
        } : {}) });
      // Stagger browser launches, but bound how long one connector may hold up
      // the remaining accounts. Ownership stays with the real start promise
      // after a caller timeout; the monitor cannot create a second session.
      const startup = connectorOperations.runLifecycle(adapter, "start", () =>
        adapter.start(onMessage, onRead, onReaction)
      );
      const startupTimeoutMs = Number(process.env.SYNC_START_TIMEOUT_MS || 90_000);
      await withDeadline(startup, startupTimeoutMs, `${acc.platform} startup`).catch((e) =>
        console.error(`[${acc.platform}:${acc.label || acc.id}] startup not ready:`, e)
      );
      console.log(
        `[sync] ${acc.platform} (${acc.driver || "default"}) ${adapter.getStatus().state} — ${acc.label || acc.id}`
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
  // An explicit account is authoritative. Falling back to another account on
  // the same platform could send from the wrong identity.
  if (body.accountId) return adapters.get(body.accountId);
  if (body.platform) {
    // Prefer a *ready* adapter — a platform can have several accounts and the
    // first one might be a half-dead duplicate (e.g. an env-session telegram
    // client that lost the AUTH_KEY_DUPLICATED race and sits in "starting").
    // Routing a send/group-create to that zombie hangs forever.
    let fallback: Adapter | undefined;
    for (const [id, meta] of accountMeta) {
      if (meta.platform !== body.platform) continue;
      const a = adapters.get(id);
      if (!a) continue;
      if (!fallback) fallback = a;
      if (a.getStatus().state === "ready") return a;
    }
    return fallback;
  }
  return undefined;
}

function startControlServer(): Promise<void> {
  const port = Number(process.env.SYNC_CONTROL_PORT || 4001);
  controlServer = http.createServer(async (req, res) => {
      if (["/avatars/backfill", "/avatars/backfill?restart=1"].includes(req.url || "") && ["GET", "POST"].includes(req.method || "")) {
        // Operational endpoint is local-only; browser cross-origin requests
        // cannot trigger downloads, and a second POST resumes the same pass.
        const remote = req.socket.remoteAddress || "";
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote) || req.headers.origin) {
          res.writeHead(403); return res.end();
        }
        try {
          if (req.method === "POST") {
            if (!initialized) {
              res.writeHead(503, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ error: "Wait for connected accounts to finish starting." }));
            }
            avatarBackfill.start(await collectAvatarJobs(prisma,
              [...adapters.entries()].filter(([, a]) => !!a.refreshAvatar).map(([id]) => id)), req.url?.endsWith("?restart=1"));
          }
          res.writeHead(req.method === "POST" ? 202 : 200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(avatarBackfill.snapshot()));
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: String(error) }));
        }
      }
      if (req.method === "POST" && req.url === "/whatsapp/qr/refresh") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", async () => {
          res.setHeader("Content-Type", "application/json");
          try {
            const { accountId } = JSON.parse(body);
            // Never fall back to a different account for a linking operation.
            const adapter = typeof accountId === "string" ? adapters.get(accountId) : undefined;
            if (!adapter || adapter.platform !== "whatsapp" || !adapter.refreshQr) {
              res.writeHead(400);
              return res.end(JSON.stringify({ error: "This WhatsApp account cannot refresh its QR code. Check that its connector is running." }));
            }
            if (adapter.getStatus().state !== "qr" || !connectorOperations.canRecover(adapter)) {
              res.writeHead(409);
              return res.end(JSON.stringify({ error: "WhatsApp is connected or busy linking. Check its status before requesting another code." }));
            }
            await connectorOperations.runLifecycle(adapter, "recover", () => adapter.refreshQr!());
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, status: adapter.getStatus() }));
          } catch (error) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Could not generate a fresh QR code." }));
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/send") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            const {
              platform,
              accountId,
              chatExternalId,
              text,
              media,
              mentions,
              replyToExternalId,
              pendingMessageId,
              waitForConfirmation,
              inboxCategory,
            } = JSON.parse(body);
            const adapter = resolveAdapter({ accountId, platform });
            if (!adapter) {
              res.writeHead(400, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({
                  error: `no running adapter for account '${accountId || platform}'`,
                })
              );
            }
            // A ready adapter already owns a live transport. Running
            // ensureReady here made every message pay for a second connector
            // check before the worker could acknowledge it. The adapter's
            // send method still performs its own final safety check.
            if (adapter.getStatus().state !== "ready" || connectorOperations.snapshot(adapter).operation === "recover") {
              res.writeHead(503, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({
                  error: `${platform || "platform"} is reconnecting; no message was sent`,
                  retryable: true,
                  accepted: false,
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
            const operation = trackedSend(
              pendingMessageId,
              adapter,
              chatExternalId,
              text,
              outMedia,
              mentions,
              replyToExternalId,
              { inboxCategory }
            );
            // The web app already rendered and persisted this message. Return
            // as soon as a ready connector owns the operation; trackedSend
            // will commit the final sent/failed state without keeping the UI's
            // HTTP request open for the platform round trip.
            if (waitForConfirmation === false) {
              res.writeHead(202, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ accepted: true, pending: true }));
              return;
            }
            try {
              const sent = await withDeadline(
                operation,
                Number(process.env.SYNC_SEND_TIMEOUT_MS || 12000),
                `${platform || "Platform"} delivery confirmation`
              );
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(sent));
            } catch (error) {
              const uncertain = isUncertainSendError(error);
              if (pendingMessageId) await markDeliveryProblem(pendingMessageId, error);
              // A confirmation deadline does not mean the browser transport is
              // broken. Recovering here closed the active X composer while its
              // send was still finishing. Only reconnect for an actual
              // transport failure; leave timed-out sends unconfirmed.
              if (
                uncertain &&
                !(error instanceof OperationTimeoutError) &&
                adapter.recover &&
                connectorOperations.canRecover(adapter)
              ) {
                void connectorOperations.runLifecycle(adapter, "recover", () => adapter.recover!()).catch((recoveryError) =>
                  console.error(`[${platform}] recovery failed:`, recoveryError)
                );
              }
              res.writeHead(uncertain ? 504 : 500, {
                "Content-Type": "application/json",
              });
              res.end(JSON.stringify({ error: String(error), uncertain, accepted: true }));
            }
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(e), uncertain: false }));
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/read") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            const { platform, accountId, chatExternalId, inboxCategory } = JSON.parse(body);
            const adapter = resolveAdapter({ accountId, platform });
            if (adapter?.markRead) {
              await adapter.markRead(chatExternalId, { inboxCategory });
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/archive") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const {
              platform,
              accountId,
              chatExternalId,
              archived,
              lastMessageId,
              lastMessageTimestamp,
              lastMessageFromMe,
              lastMessageParticipant,
            } = JSON.parse(body);
            const adapter = resolveAdapter({ accountId, platform });
            if (!adapter) {
              res.writeHead(503, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({
                  error: `no running messaging connection for ${platform || "this chat"}`,
                })
              );
            }
            if (!adapter.setArchivedAndMuted) {
              res.writeHead(400, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({
                  error: `archive and mute isn't supported for ${platform || "this platform"}`,
                })
              );
            }
            if (adapter.ensureReady) {
              await withDeadline(
                adapter.ensureReady(),
                Number(process.env.SYNC_CONNECT_TIMEOUT_MS || 6000),
                `${platform || "Platform"} connection check`
              );
            }
            if (adapter.getStatus().state !== "ready") {
              res.writeHead(503, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({
                  error: `${platform || "platform"} is reconnecting`,
                })
              );
            }
            await withDeadline(
              adapter.setArchivedAndMuted(chatExternalId, archived === true, {
                lastMessageId,
                lastMessageTimestamp,
                lastMessageFromMe: lastMessageFromMe === true,
                lastMessageParticipant,
              }),
              Number(process.env.SYNC_ARCHIVE_TIMEOUT_MS || 12000),
              `${platform || "Platform"} archive`
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.writeHead(error instanceof OperationTimeoutError ? 504 : 500, {
              "Content-Type": "application/json",
            });
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/react") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const {
              platform,
              accountId,
              chatExternalId,
              messageExternalId,
              emoji,
              remove,
              fromMe,
              senderExternalKey,
            } = JSON.parse(body);
            const adapter = resolveAdapter({ accountId, platform });
            if (!adapter?.react) {
              res.writeHead(400, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({ error: `reactions aren't supported for ${platform}` })
              );
            }
            if (adapter.ensureReady) {
              await withDeadline(
                adapter.ensureReady(),
                Number(process.env.SYNC_CONNECT_TIMEOUT_MS || 6000),
                `${platform || "Platform"} connection check`
              );
            }
            if (adapter.getStatus().state !== "ready") {
              res.writeHead(503, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({ error: `${platform || "platform"} is reconnecting` })
              );
            }
            await withDeadline(
              adapter.react(chatExternalId, messageExternalId, {
                emoji,
                remove: remove === true,
                fromMe: fromMe === true,
                senderExternalKey,
              }),
              Number(process.env.SYNC_REACTION_TIMEOUT_MS || 10000),
              `${platform || "Platform"} reaction`
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.writeHead(error instanceof OperationTimeoutError ? 504 : 500, {
              "Content-Type": "application/json",
            });
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/history") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            const { platform, accountId, chatExternalId, oldestMessageId, oldestTimestamp, count, isGroup, inboxCategory, sinceTimestamp, anchorFromMe } = JSON.parse(body);
            const adapter = resolveAdapter({ accountId, platform });
            if (!adapter?.requestHistory)
              throw new Error(`history requests aren't supported for ${platform}`);
            const historyStatus = adapter.getStatus();
            if (historyStatus.state !== "ready")
              throw new Error(platform === "x" && historyStatus.detail ? historyStatus.detail : `${platform || "platform"} is reconnecting`);
            const requestedWindowMs =
              typeof sinceTimestamp === "number"
                ? Math.max(0, Date.now() - sinceTimestamp)
                : 0;
            const historyTimeoutMs = platform === "x" ? 120_000 : requestedWindowMs > 24 * 60 * 60 * 1000
              ? Math.max(
                  Number(process.env.SYNC_HISTORY_TIMEOUT_MS || 20000),
                  65_000
                )
              : Number(process.env.SYNC_HISTORY_TIMEOUT_MS || 20000);
            await withDeadline(
              adapter.requestHistory(chatExternalId, oldestMessageId, oldestTimestamp, count, {
                isGroup: isGroup === true,
                inboxCategory: inboxCategory === "spam" ? "spam" : "general",
                sinceTimestamp:
                  typeof sinceTimestamp === "number" ? sinceTimestamp : undefined,
                anchorFromMe: anchorFromMe === true,
              }),
              historyTimeoutMs,
              `${platform || "Platform"} history request`
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(e instanceof OperationTimeoutError ? 504 : 500, {
              "Content-Type": "application/json",
            });
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/media/recover") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const {
              platform,
              accountId,
              chatExternalId,
              messageExternalId,
              automatic,
            } = JSON.parse(body);
            const adapter = resolveAdapter({ accountId, platform });
            if (!adapter?.recoverMedia) {
              res.writeHead(400, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({
                  error: `${platform || "This platform"} cannot recover individual attachments`,
                })
              );
            }
            if (adapter.getStatus().state !== "ready") {
              res.writeHead(503, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({ error: `${platform || "platform"} is reconnecting` })
              );
            }
            await withDeadline(
              adapter.recoverMedia(chatExternalId, messageExternalId, { automatic: automatic === true }),
              Number(process.env.SYNC_MEDIA_RECOVERY_TIMEOUT_MS || 300000),
              `${platform || "Platform"} attachment recovery`
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.writeHead(error instanceof OperationTimeoutError ? 504 : 500, {
              "Content-Type": "application/json",
            });
            res.end(JSON.stringify({ error: String(error).replace(/^Error:\s*/, "") }));
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/group/create") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            const { platform, accountId, name, participantKeys, message } =
              JSON.parse(body);
            const adapter = resolveAdapter({ accountId, platform });
            if (!adapter?.createGroup) {
              res.writeHead(400, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({
                  error: `creating groups isn't supported for ${platform}`,
                })
              );
            }
            const group = await connectorOperations.send(adapter, async () => {
              const result = await adapter.createGroup!(name, participantKeys || [], message);
              const { chatExternalId, initialMessageSent } = result;
              if (message && chatExternalId && !initialMessageSent) {
                await adapter.send(chatExternalId, message);
              }
              return result;
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, ...group }));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/conversation/resolve") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const { platform, accountId, target } = JSON.parse(body);
            const adapter = resolveAdapter({ accountId, platform });
            if (!adapter?.resolveDirectContact) {
              res.writeHead(400, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({
                  error: `starting direct messages isn't supported for ${platform}`,
                })
              );
            }
            // Exact sender evidence helps recover a group member's identity
            // even after the connector's in-memory contacts cache was restarted.
            const senderEvidence = platform === "whatsapp" ? await prisma.message.findFirst({
              where: {
                senderContact: { externalKey: { in: directRecipientIds(platform, String(target || "")).map(id => `whatsapp:${id}`) } },
                conversation: { accountId, contact: { isGroup: true } },
              },
              orderBy: { createdAt: "desc" },
              select: { externalKey: true, conversation: { select: { externalId: true } } },
            }) : null;
            const contact = await withDeadline(
              adapter.resolveDirectContact(String(target || ""), {
                groupExternalId: senderEvidence?.conversation.externalId || undefined,
                senderMessageExternalId: senderEvidence?.externalKey || undefined,
              }),
              Number(process.env.SYNC_CONTACT_RESOLVE_TIMEOUT_MS || 20_000),
              `${platform || "Platform"} recipient lookup`
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, ...contact }));
          } catch (error) {
            res.writeHead(error instanceof OperationTimeoutError ? 504 : 500, {
              "Content-Type": "application/json",
            });
            res.end(
              JSON.stringify({ error: String(error).replace(/^Error:\s*/, "") })
            );
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/shutdown") {
        const expectedPid = req.headers["x-omni-expected-worker-pid"];
        if (expectedPid !== undefined && expectedPid !== String(process.pid)) {
          res.writeHead(409, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "The previous sync worker has already been replaced", pid: process.pid }));
        }
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, stopping: true }));
        // Finish the response before closing the control server and connector
        // transports. The web app can then watch /health disappear before it
        // launches a replacement worker.
        setImmediate(() => void shutdown("manual restart"));
        return;
      }
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            ok: !shuttingDown,
            pid: process.pid,
            initialized,
            avatars: avatarBackfill?.snapshot(),
            accounts: [...adapters.keys()],
            connectors: [...adapters.entries()].map(([accountId, adapter]) => ({
              accountId,
              ...adapter.getStatus(),
              ...connectorOperations.snapshot(adapter),
            })),
          })
        );
      }
      if (req.method === "POST" && req.url === "/reload") {
        try {
          await startAdapters();
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, accounts: [...adapters.keys()] }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: String(e) }));
        }
      }
      if (req.method === "GET" && req.url === "/status") {
        // Per-platform aggregate (back-compat with the current Connections UI),
        // plus a per-account list for the multi-account UI.
        const status: Record<string, unknown> = {};
        for (const p of ["telegram", "whatsapp", "x", "discord", "gmail"])
          status[p] = { platform: p, state: "disabled" };
        const accounts: unknown[] = [];
        for (const [id, adapter] of adapters) {
          const meta = accountMeta.get(id);
          const s = adapter.getStatus();
          if (meta) status[meta.platform] = s;
          accounts.push({ accountId: id, label: meta?.label, ...s });
        }
        status.accounts = accounts;
        status.initialized = initialized;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(status));
      }
      res.writeHead(404);
      res.end();
    });
  return new Promise((resolve, reject) => {
    controlServer!.once("error", reject);
    controlServer!.listen(port, () => {
      console.log(`[sync] control server on :${port}`);
      resolve();
    });
  });
}

// Fire recurring (scheduled) automations when they're due. The web app holds
// the engine, so we just trigger its /run endpoint for each due automation.
function startAutomationScheduler() {
  const webUrl =
    process.env.WEB_URL || `http://localhost:${process.env.PORT || 3000}`;
  const tick = async () => {
    try {
      const autos = await prisma.automation.findMany({
        where: { enabled: true, schedule: { in: ["daily", "every_n_days"] } },
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

function startConnectorRecovery() {
  const linked = new WeakSet<Adapter>();
  const unhealthySince = new WeakMap<Adapter, number>();
  const healthySince = new WeakMap<Adapter, number>();
  const recoveryAttempts = new WeakMap<Adapter, number>();
  const nextRecoveryAt = new WeakMap<Adapter, number>();
  let nextStartupAttemptAt = 0;
  const tick = () => {
    if (shuttingDown) return;
    // Reconcile new/relinked accounts even if a browser closes before /reload
    // answers, and retry a temporary startup DB/config failure.
    if (!adapterReload && Date.now() >= nextStartupAttemptAt) {
      nextStartupAttemptAt = Date.now() + 30_000;
      void startAdapters().catch((error) =>
        console.error("[sync] connector startup retry failed:", error)
      );
    }
    for (const [id, adapter] of adapters) {
      const { state, detail } = adapter.getStatus();
      const now = Date.now();
      if (state === "ready") {
        if (!linked.has(adapter)) {
          linked.add(adapter);
          void prisma.account.updateMany({ where: { id, status: "pending" }, data: { status: "connected" } })
            .catch(() => linked.delete(adapter));
        }
        unhealthySince.delete(adapter);
        const stableSince = healthySince.get(adapter) ?? now;
        healthySince.set(adapter, stableSince);
        // Brief ready/disconnected flaps must not reset retry pacing.
        if (now - stableSince > 60_000) {
          recoveryAttempts.delete(adapter);
          nextRecoveryAt.delete(adapter);
        }
        continue;
      }
      healthySince.delete(adapter);

      // X owns a persistent circuit breaker and browser lifecycle, so a
      // second recovery loop would fight its cooldown. Telegram's built-in
      // retries are deliberately bounded; once they finish, this monitor must
      // give the socket one serialized reconnect or it can remain "starting"
      // forever after a network drop.
      if (adapter.platform === "x") continue;
      // Expired credentials and QR pairing need the platform's sign-in flow.
      // Reopening the same invalid session every minute cannot repair it.
      if (/logged out|session (?:expired|invalidated)|auth_key_(?:duplicated|unregistered)|invalid (?:bot )?token|unauthori[sz]ed|scan.*qr/i.test(detail || "")) {
        unhealthySince.delete(adapter);
        continue;
      }

      // Only restart adapters that expose an actual recovery operation. A
      // normal heavy-browser boot can take a while, so do not tear it down just
      // because it has been in "starting" for a few monitor ticks.
      const since = unhealthySince.get(adapter) ?? now;
      unhealthySince.set(adapter, since);
      const stuckForMs = now - since;
      const recoverableState =
        state === "starting" ||
        ((adapter.platform === "whatsapp" || adapter.platform === "telegram") &&
          state === "disconnected");
      const recoveryGraceMs =
        state === "disconnected"
          ? Number(process.env.SYNC_DISCONNECTED_RECOVERY_GRACE_MS || 20_000)
          : Number(process.env.SYNC_RECOVERY_GRACE_MS || 60_000);
      if (
        !connectorOperations.canRecover(adapter) ||
        !recoverableState ||
        stuckForMs < recoveryGraceMs ||
        now < (nextRecoveryAt.get(adapter) || 0) ||
        !adapter.recover
      ) continue;
      const attempts = (recoveryAttempts.get(adapter) || 0) + 1;
      recoveryAttempts.set(adapter, attempts);
      const retryDelayMs = Math.min(300_000, 20_000 * 2 ** Math.min(attempts - 1, 4));
      console.log(`[sync] recovering ${adapter.platform}:${id} (attempt ${attempts})`);
      const recovery = connectorOperations.runLifecycle(adapter, "recover", () => adapter.recover!());
      const finished = () => {
        unhealthySince.set(adapter, Date.now());
        nextRecoveryAt.set(adapter, Date.now() + retryDelayMs);
      };
      // Release only when the real operation settles, never when its observer
      // deadline expires. Otherwise a hung reconnect spawns overlapping ones.
      void recovery.then(finished, finished);
      void withDeadline(
        recovery,
        Number(process.env.SYNC_CONNECT_TIMEOUT_MS || 60_000),
        `${adapter.platform} recovery`
      )
        .catch((error) => console.error(`[sync] ${adapter.platform}:${id} recovery pending or failed:`, error));
    }
  };
  recoveryTimer = setInterval(tick, 10_000);
  recoveryTimer.unref?.();
  console.log("[sync] connector recovery monitor started");
}

async function main() {
  // Protect the actual auth/profile directories as well as the control port:
  // another worker on a different port must never open the same sessions.
  releaseWorkerLocks = acquireWorkerLocks([
    process.cwd(),
    process.env.DATA_DIR || process.cwd(),
  ]);
  // Own the port before any account session opens. A duplicate worker exits
  // here without touching another worker's Telegram keys or browser profile.
  await startControlServer();
  await prismaReady;
  retention = new MessageRetention(path.join(process.env.DATA_DIR || process.cwd(), ".local", "sync-retention"));
  avatarBackfill = new AvatarBackfill(path.join(process.env.DATA_DIR || process.cwd(), ".local", "avatar-backfill.json"));
  startAutomationScheduler();
  startOcrIndexer();
  // Startup is tracked per connector, so its watchdog can run immediately
  // without racing initial launches or waiting on a different stuck account.
  startConnectorRecovery();
  try {
    await startAdapters();
    avatarTimer = setInterval(() => {
      if (shuttingDown) return;
      for (const [accountId, adapter] of adapters) {
        const activity = connectorOperations.snapshot(adapter);
        if (!adapter.refreshAvatar || adapter.getStatus().state !== "ready" || activity.activeSends || activity.operation) continue;
        void avatarBackfill.runOne(accountId, async job => {
          const where = avatarContactWhere(job);
          const contact = await prisma.contact.findFirst({ where, select: { id: true } });
          if (!contact) return "skipped";
          const result = await adapter.refreshAvatar!(job.chatId, job.isGroup, {
            groupExternalId: job.groupExternalId, senderMessageExternalId: job.senderMessageExternalId,
          });
          // Missing/private photos do not erase an existing good picture.
          if (result.url) await prisma.contact.updateMany({ where, data: { avatarUrl: result.url } });
          return result;
        }).catch(error => console.error("[avatars] queue persistence failed:", error));
      }
    }, 2000);
    avatarTimer.unref?.();
    await retention.replay(new Set(adapters.keys()), persistInbound).catch(error => console.error("[retention] initial message retry deferred:", error));
    await seedRecentMedia().catch(error => console.error("[retention] recent media seed deferred:", error));
    retentionTimer = setInterval(() => {
      if (shuttingDown) return;
      void retention.replay(new Set(adapters.keys()), persistInbound).catch(error => console.error("[retention] message retry deferred:", error));
      for (const [accountId, adapter] of adapters) {
        if (!adapter.recoverMedia || adapter.getStatus().state !== "ready" || !connectorOperations.canRecover(adapter)) continue;
        void retention.runOne(accountId, async job => {
          const message = await prisma.message.findFirst({ where: { externalKey: job.messageId, conversation: { accountId } }, select: { mediaUrl: true } });
          if (!message) return true;
          const exists = (url: string | null) => !!url?.startsWith("/media/") && fs.existsSync(path.join(process.cwd(), "public", url));
          if (exists(message.mediaUrl)) return true;
          // X's own requestHistory enforces its shared cooldown, busy/send
          // guards and network pacing. Never bypass those for attachments.
          await adapter.recoverMedia!(job.chatId, job.messageId, { automatic: true });
          const updated = await prisma.message.findUnique({ where: { externalKey: job.messageId }, select: { mediaUrl: true } });
          return exists(updated?.mediaUrl || null);
        }, adapter.platform === "x" ? 120_000 : 15_000).catch(error => console.error("[retention] queue failed:", error));
      }
    }, 15_000);
    retentionTimer.unref?.();
    console.log("[retention] durable message journal and paced attachment archive enabled");
  } catch (e) {
    console.error("[sync] startAdapters error (continuing):", e);
  }
}

let shuttingDown = false;

async function seedRecentMedia() {
  // Repair the recent gap, not an unbounded download of years of history.
  // Every newly ingested message is queued independently regardless of age.
  const rows = await prisma.message.findMany({ where: {
    mediaType: { not: null }, OR: [{ mediaUrl: null }, { mediaUrl: { startsWith: "https://" } }], externalKey: { not: null },
    createdAt: { gte: new Date(Date.now() - 72 * 60 * 60_000) },
    conversation: { accountId: { in: [...adapters.keys()] } },
  }, orderBy: { createdAt: "desc" }, take: 1000, include: { conversation: true } });
  for (const row of rows) retention.enqueueMedia({
    accountId: row.conversation.accountId!, platform: row.conversation.platform as InboundMessage["platform"],
    chatExternalId: row.conversation.externalId!, messageExternalId: row.externalKey!, timestamp: row.createdAt,
    media: { type: row.mediaType as NonNullable<InboundMessage["media"]>["type"], url: null },
    direction: row.direction as "in" | "out", body: "", contact: { externalKey: "", name: "", handle: "" },
  });
}
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (recoveryTimer) clearInterval(recoveryTimer);
  if (retentionTimer) clearInterval(retentionTimer);
  if (avatarTimer) clearInterval(avatarTimer);
  controlServer?.close();
  console.log(`[sync] ${signal} received; closing connectors`);
  await Promise.all(
    [...adapters.entries()].map(([id, adapter]) =>
      withDeadline(adapter.stop(), 10_000, `${adapter.platform}:${id} shutdown`).catch(
        (error) => console.error(`[sync] connector shutdown failed (${id}):`, error)
      )
    )
  );
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("exit", () => {
  try { releaseWorkerLocks?.(); }
  catch (error) { console.error("[sync] failed to release session ownership:", error); }
});

main().catch((e) => {
  console.error("[sync] startup failed:", e);
  // Service supervision can only restart failed startup if the process exits.
  process.exit(1);
});
