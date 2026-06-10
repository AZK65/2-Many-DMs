// Production entrypoint: runs the Next server and the sync worker in one
// container so they share the same filesystem (SQLite DB, media, sessions) and
// the worker's control server is reachable at localhost.
const { spawn, spawnSync } = require("node:child_process");

const port = process.env.PORT || "3000";

// Ensure the (possibly fresh, volume-backed) SQLite DB has the schema.
console.log("[start] applying database schema…");
spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
  stdio: "inherit",
});

let dying = false;

// The web server is the container's lifeline — if it dies, the container exits
// (Railway restarts it). The worker is supervised separately and restarted on
// crash so a platform error (e.g. a bad Telegram session) never takes down the
// UI.
const web = spawn("npx", ["next", "start", "-p", String(port)], {
  stdio: "inherit",
});
web.on("exit", (c) => {
  console.error("[start] web exited", c);
  shutdown(c || 0);
});

let worker;
function startWorker() {
  worker = spawn("npx", ["tsx", "sync/worker.ts"], { stdio: "inherit" });
  worker.on("exit", (c) => {
    if (dying) return;
    console.error(`[start] worker exited (${c}) — restarting in 10s`);
    setTimeout(startWorker, 10000);
  });
}
startWorker();

function shutdown(code) {
  if (dying) return;
  dying = true;
  try { web.kill("SIGTERM"); } catch {}
  try { worker && worker.kill("SIGTERM"); } catch {}
  process.exit(code);
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
