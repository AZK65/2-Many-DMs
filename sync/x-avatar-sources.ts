import fs from "node:fs";
import path from "node:path";

function validSource(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "pbs.twimg.com"; }
  catch { return false; }
}

/** Retain observed CDN URLs so a restart does not turn a forced refresh into
 * a cache-only lookup for every chat outside X's currently visible inbox. */
export class XAvatarSources {
  private sources = new Map<string, string>();
  constructor(private file?: string) {
    if (!file || !fs.existsSync(file)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        for (const [id, url] of Object.entries(saved)) if (validSource(url)) this.sources.set(id, url);
      }
    } catch { /* A bad cache must not stop the connector. */ }
  }
  get(id: string) { return this.sources.get(id); }
  remember(entries: Array<{ id: string; avatar?: string }>) {
    let changed = false;
    for (const { id, avatar } of entries) {
      if (validSource(avatar) && avatar !== this.sources.get(id)) { this.sources.set(id, avatar); changed = true; }
    }
    if (changed && this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(Object.fromEntries(this.sources)));
      fs.renameSync(`${this.file}.tmp`, this.file);
    }
  }
}
