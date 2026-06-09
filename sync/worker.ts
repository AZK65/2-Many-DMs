import "dotenv/config";
import http from "node:http";
import { TelegramAdapter } from "./adapters/telegram";
import { WhatsAppAdapter } from "./adapters/whatsapp";
import { XAdapter } from "./adapters/x";
import { persistInbound } from "./store";
import type { Adapter } from "./adapters/types";

const adapters = new Map<string, Adapter>();

async function startAdapters() {
  const { TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION } = process.env;
  if (TELEGRAM_API_ID && TELEGRAM_API_HASH && TELEGRAM_SESSION) {
    const tg = new TelegramAdapter(
      Number(TELEGRAM_API_ID),
      TELEGRAM_API_HASH,
      TELEGRAM_SESSION
    );
    await tg.start(persistInbound);
    adapters.set("telegram", tg);
    console.log("[sync] telegram adapter started");
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
    wa.start(persistInbound).catch((e) =>
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
            const { platform, chatExternalId, text } = JSON.parse(body);
            const adapter = adapters.get(platform);
            if (!adapter) {
              res.writeHead(400, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({ error: `adapter '${platform}' not running` })
              );
            }
            const sent = await adapter.send(chatExternalId, text);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(sent));
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

async function main() {
  // Control server first so /status + /send respond during the (possibly slow,
  // staggered) adapter startup.
  startControlServer();
  await startAdapters();
}

main().catch((e) => {
  console.error("[sync] fatal:", e);
  process.exit(1);
});
