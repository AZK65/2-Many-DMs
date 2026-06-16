import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = "AZK65/2-Many-DMs";
const DEFAULT_FEED = `https://raw.githubusercontent.com/${REPO}/master/public/changelog.json`;

type Entry = { version: string; date?: string; title?: string; notes?: string[] };
type Feed = { current?: string; entries?: Entry[] };

// Compare semver-ish "a.b.c" strings. Returns true if x > y.
function gt(x: string, y: string): boolean {
  const a = x.split(".").map((n) => parseInt(n, 10) || 0);
  const b = y.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

function localFeed(): Feed {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "public", "changelog.json"),
      "utf8"
    );
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function versionOf(f: Feed): string {
  return f.current || f.entries?.[0]?.version || "0.0.0";
}

// Compares the running build's bundled changelog against the one published on
// GitHub. If the remote is ahead, returns the newer entries so the UI can show
// "what's new". Any network/parse failure → no update (never blocks the app).
export async function GET() {
  const local = localFeed();
  const current = versionOf(local);
  const feedUrl = process.env.UPDATE_FEED_URL || DEFAULT_FEED;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(feedUrl, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const remote: Feed = await res.json();
    const latest = versionOf(remote);
    const hasUpdate = gt(latest, current);
    const newEntries = (remote.entries || []).filter((e) => gt(e.version, current));
    return NextResponse.json({
      current,
      latest,
      hasUpdate,
      entries: hasUpdate ? newEntries : [],
      repo: REPO,
      repoUrl: `https://github.com/${REPO}`,
      selfUpdate: process.env.ALLOW_SELF_UPDATE === "1",
    });
  } catch {
    return NextResponse.json({ current, latest: current, hasUpdate: false, entries: [] });
  }
}
