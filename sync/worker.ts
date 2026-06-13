import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { TelegramAdapter } from "./adapters/telegram";
import { WhatsAppAdapter } from "./adapters/whatsapp";
import { XAdapter } from "./adapters/x";
import { persistInbound, persistRead, prisma } from "./store";
import type { Adapter } from "./adapters/types";

const adapters = new Map<string, Adapter>();

async function startAdapters() {
  const { TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION } = process.env;
  if (TELEGRAM_API_ID && TELEGRAM_API_HASH && TELEGRAM_SESSION) {
    // Non-fatal: a bad/duplicated session (AUTH_KEY_DUPLICATED) must not crash
    // the whole worker and take down the other platforms + control server.
    try {
      const tg = new TelegramAdapter(
        Number(TELEGRAM_API_ID),
        TELEGRAM_API_HASH,
        TELEGRAM_SESSION
      );
      await tg.start(persistInbound, (id) => persistRead("telegram", id));
      adapters.set("telegram", tg);
      console.log("[sync] telegram adapter started");
    } catch (e) {
      console.error(
        "[telegram] start failed (continuing without it) — re-run `npm run tg:login` if the session is invalid:",
        e
      );
    }
  } else {
    console.log(
      "[sync] telegram not configured — set TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION (run `npm run tg:login`)."
    );
  }

  let wa: WhatsAppAdapter | undefined;
  if (process.env.WHATSAPP_ENABLED === "1") {
    wa = new WhatsAppAdapter();
    adapters.set("whatsapp", wa);
    // Not awaited: initialize() blocks until the QR is scanned / session loads.
    wa.start(persistInbound, (id) => persistRead("whatsapp", id)).catch((e) =>
      console.error("[whatsapp] start error:", e)
    );
    console.log("[sync] whatsapp adapter starting (scan the QR if prompted)");
  } else {
    console.log("[sync] whatsapp disabled — set WHATSAPP_ENABLED=1 to connect.");
  }

  // Stagger the browsers: WhatsApp Web and XChat are both heavy Chrome SPAs;
  // starting them at once starves each other (WhatsApp stalls). Wait for
  // WhatsApp to settle (ready, or a cap) before launching X.
  if (process.env.X_ENABLED === "1") {
    if (wa) {
      const capMs = Number(process.env.X_START_AFTER_WA_MS || 120000);
      const start = Date.now();
      while (
        wa.getStatus().state !== "ready" &&
        Date.now() - start < capMs
      ) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      console.log(
        `[sync] whatsapp ${wa.getStatus().state} after ${Math.round(
          (Date.now() - start) / 1000
        )}s — starting x`
      );
    }
    const x = new XAdapter();
    adapters.set("x", x);
    x.start(persistInbound).catch((e) => console.error("[x] start error:", e));
    console.log("[sync] x adapter starting");
  } else {
    console.log("[sync] x disabled — set X_ENABLED=1 and run `npm run x:login`.");
  }
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
            const { platform, chatExternalId, text, media } = JSON.parse(body);
            const adapter = adapters.get(platform);
            if (!adapter) {
              res.writeHead(400, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({ error: `adapter '${platform}' not running` })
              );
            }
            // The web side passes a served path ("/media/x.jpg"); resolve it to
            // the real file on the shared disk for the adapter to upload.
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
            const { platform, chatExternalId } = JSON.parse(body);
            const adapter = adapters.get(platform);
            // markRead is optional (X can't reliably mark read) — no-op then.
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
          JSON.stringify({ ok: true, adapters: [...adapters.keys()] })
        );
      }
      if (req.method === "GET" && req.url === "/status") {
        const platforms = ["telegram", "whatsapp", "x"] as const;
        const status: Record<string, unknown> = {};
        for (const p of platforms) status[p] = { platform: p, state: "disabled" };
        for (const [key, adapter] of adapters) status[key] = adapter.getStatus();
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
  // Control server first so /status + /send respond during the (possibly slow,
  // staggered) adapter startup.
  startControlServer();
  startAutomationScheduler();
  try {
    await startAdapters();
  } catch (e) {
    // Keep the worker (and its control server) alive even if startup partially
    // fails — a single platform error must not kill the process.
    console.error("[sync] startAdapters error (continuing):", e);
  }
}

main().catch((e) => console.error("[sync] error:", e));

