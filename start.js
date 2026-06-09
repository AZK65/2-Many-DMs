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

const web = spawn("npx", ["next", "start", "-p", String(port)], {
  stdio: "inherit",
});
const worker = spawn("npx", ["tsx", "sync/worker.ts"], { stdio: "inherit" });

let dying = false;
function shutdown(code) {
  if (dying) return;
  dying = true;
  web.kill("SIGTERM");
  worker.kill("SIGTERM");
  process.exit(code);
}

web.on("exit", (c) => {
  console.error("[start] web exited", c);
  shutdown(c || 0);
});
worker.on("exit", (c) => {
  console.error("[start] worker exited", c);
  shutdown(c || 0);
});
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
