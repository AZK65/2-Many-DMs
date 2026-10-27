import { prisma } from "@/lib/db";
import { timingSafeEqual } from "crypto";

/**
 * Social listening — the CRM side of the standalone X listener.
 *
 * The listener scrapes X, qualifies posts with an LLM, and POSTs whole runs to
 * /api/listening/ingest. This module owns the shared contract: payload shape,
 * ingest auth, retention, and erasure.
 *
 * Retention note: SocialLead rows are personal data (handle, bio, the person's
 * own words in a public post). The listener expires its copies
 * after 90/365 days and has a purge CLI; those cannot reach this database, so
 * the same guarantees are reimplemented here.
 */

export const LEAD_RETENTION_DAYS = Number(process.env.LISTENING_RETENTION_DAYS || 180);

export type Tier = "HOT" | "WARM" | "REJECT";

export type IncomingLead = {
  id?: string;
  username?: string;
  displayName?: string;
  bio?: string;
  followers?: string;
  content?: string;
  url?: string;
  matchedQuery?: string;
  timestamp?: string;
  tier?: string;
  reason?: string | null;
  decision?: string | null;
  kind?: string | null;
};

export type IngestPayload = {
  platform?: string;
  leads?: IncomingLead[];
  stats?: { found?: number; new?: number; hot?: number; warm?: number; watcher?: string };
};

/** Constant-time bearer check for the listener's shared secret. */
export function ingestSecretValid(header: string | null): boolean {
  const secret = process.env.LISTENING_INGEST_SECRET || "";
  if (!secret) return false; // unset means the endpoint stays closed, not open
  const supplied = (header || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function normaliseTier(lead: IncomingLead): Tier {
  const raw = String(lead.tier || "").toUpperCase();
  if (raw === "HOT" || raw === "WARM" || raw === "REJECT") return raw;
  // Older listener builds only sent decision RELEVANT/REJECT.
  return String(lead.decision || "").toUpperCase() === "RELEVANT" ? "WARM" : "REJECT";
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// The configured listener owns classification. Do not assume a company,
// account handle, or industry from the text of someone else's post.
export function isSupportLead(lead: IncomingLead): boolean {
  return String(lead.kind || "").toLowerCase() === "support";
}

/**
 * Upsert a run's leads. Re-ingesting the same post updates the verdict but
 * never clobbers your workflow state (status / rating / notes) — the listener
 * does not know you already contacted someone.
 */
export async function ingestRun(payload: IngestPayload) {
  const platform = payload.platform || "twitter";
  const watcher = payload.stats?.watcher || null;
  const leads = Array.isArray(payload.leads) ? payload.leads : [];

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const lead of leads) {
    const postId = String(lead.id || "").trim();
    if (!postId || !lead.username || !lead.content) {
      skipped++;
      continue;
    }

    const data = {
      platform,
      kind: isSupportLead(lead) ? "support" : "lead",
      postId,
      watcher,
      username: lead.username,
      displayName: lead.displayName || null,
      bio: lead.bio || null,
      followers: lead.followers || null,
      content: lead.content,
      url: lead.url || `https://x.com/${lead.username}/status/${postId}`,
      matchedQuery: lead.matchedQuery || null,
      tier: normaliseTier(lead),
      reason: lead.reason || null,
      postedAt: parseDate(lead.timestamp),
    };

    const existing = await prisma.socialLead.findUnique({
      where: { platform_postId: { platform, postId } },
      select: { id: true },
    });

    if (existing) {
      await prisma.socialLead.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.socialLead.create({ data });
      created++;
    }
  }

  await prisma.socialRun.create({
    data: {
      watcher,
      found: payload.stats?.found ?? 0,
      fresh: payload.stats?.new ?? 0,
      hot: payload.stats?.hot ?? 0,
      warm: payload.stats?.warm ?? 0,
    },
  });

  const expired = await enforceLeadRetention();

  return { created, updated, skipped, expired };
}

/**
 * Age out old leads. Anything you acted on (contacted, or rated as training
 * feedback) is kept — that is a record of your own business activity, not
 * passive surveillance of a stranger.
 */
export async function enforceLeadRetention(days = LEAD_RETENTION_DAYS) {
  if (!days) return 0;
  const cutoff = new Date(Date.now() - days * 86400000);
  const { count } = await prisma.socialLead.deleteMany({
    where: {
      receivedAt: { lt: cutoff },
      status: { not: "contacted" },
      rating: null,
    },
  });
  return count;
}

/** Erasure — forget one person, or one post, completely. */
export async function purgeLead({ username, postId }: { username?: string; postId?: string }) {
  if (!username && !postId) return { deleted: 0 };
  const { count } = await prisma.socialLead.deleteMany({
    where: username
      ? { username: username.replace(/^@/, "") }
      : { postId: String(postId) },
  });
  return { deleted: count };
}

/**
 * Relay a 👍/👎 back to the listener so its few-shot examples keep learning
 * from what you actually like. Best-effort: a CRM rating must still save even
 * if the listener is down.
 */
export async function relayFeedbackToListener(lead: {
  postId: string;
  username: string;
  content: string;
  watcher: string | null;
  rating: string;
}) {
  const base = process.env.LISTENING_URL;
  if (!base) return { relayed: false, reason: "LISTENING_URL not set" };

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LISTENING_CONFIG_KEY
          ? { Authorization: `Bearer ${process.env.LISTENING_CONFIG_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        watcher: lead.watcher,
        rating: lead.rating,
        tweet: { id: lead.postId, username: lead.username, content: lead.content },
      }),
      signal: AbortSignal.timeout(5000),
    });
    return { relayed: res.ok, reason: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { relayed: false, reason: (e as Error).message };
  }
}
