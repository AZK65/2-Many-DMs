// Build the public site from a separate, allowlisted Next app.
// Never export the personal workspace or copy the repository's public/ wholesale.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const website = path.join(root, "website");
const assets = [
  "brand/lockup-dark.png", "brand/lockup-light.png", "brand/icon-dark.png",
  "brand/icon-light.png", "brand/stacked-dark.png", "brand/stacked-light.png",
  "icon-192.png", "icon-512.png", "changelog.json",
];
await fs.mkdir(path.join(website, "public", "brand"), { recursive: true });
for (const asset of assets) await fs.copyFile(path.join(root, "public", asset), path.join(website, "public", asset));
await fs.copyFile(path.join(root, "public/icon-192.png"), path.join(website, "app/icon.png"));
const allowedPublic = new Set([...assets, "_headers", "robots.txt", "sitemap.xml"]);
async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Refusing symlink: ${relative}`);
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative));
    else result.push(relative);
  }
  return result;
}
for (const file of await files(path.join(website, "public"))) assert.ok(allowedPublic.has(file), `Unexpected public file: ${file}`);
await new Promise((resolve, reject) => {
  const build = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build", website], {
    cwd: root, stdio: "inherit", env: { ...process.env, MARKETING_ONLY: "1", NEXT_TELEMETRY_DISABLED: "1" },
  });
  build.once("error", reject);
  build.once("exit", code => code === 0 ? resolve() : reject(new Error(`Website build exited ${code}`)));
});
const output = path.join(website, "out");
const exported = await files(output);
const routes = new Set(["index", "landing", "changelog", "privacy", "404"]);
for (const file of exported) {
  const allowed = allowedPublic.has(file) || file === "icon.png" ||
    file.startsWith("_next/static/") || ([".html", ".txt"].includes(path.extname(file)) && routes.has(file.slice(0, -path.extname(file).length)));
  assert.ok(allowed && !file.endsWith(".map"), `Unexpected export: ${file}`);
  assert.ok((await fs.stat(path.join(output, file))).size < 25 * 1024 * 1024, `File exceeds Pages asset limit: ${file}`);
}
for (const required of ["index.html", "landing.html", "privacy.html", "changelog.html", "404.html"]) assert.ok(exported.includes(required), `Missing page: ${required}`);
console.log(`Public export verified: ${exported.length} files. No API routes, database, sessions, source maps, or private uploads. Ready in website/out.`);
