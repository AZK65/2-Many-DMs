import fs from "fs";
import path from "path";

/**
 * Posting public replies to X from the CRM.
 *
 * This drives x.com's own web endpoints with your session cookies — the same
 * auth sync/adapters/x-api.ts already uses for DMs. It is not the official API,
 * so treat it as your account acting, with all that implies:
 *
 *   • Bulk unsolicited replies are what X's spam heuristics look for. The daily
 *     cap and the duplicate-text check below exist to keep the behaviour
 *     human-shaped, not to satisfy a rule.
 *   • A public reply is permanent and attached to the brand. Nothing here
 *     generates text on its own — a person types every reply.
 *
 * Endpoint strategy: the GraphQL CreateTweet mutation x.com itself uses, with
 * v1.1 statuses/update as a fallback (those write endpoints are retired and now
 * answer with an empty body). CreateTweet's mutation id rotates on every bundle
 * release, so it is scraped from X's own JS at runtime and cached.
 */

const BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const AUTH_FILE = path.join(process.cwd(), ".x_auth", "cookies.json");

export const REPLY_DAILY_CAP = Number(process.env.X_REPLY_DAILY_CAP || 15);
export const REPLY_MIN_LENGTH = 15;
export const REPLY_MAX_LENGTH = 280;

function loadAuth(): { authToken: string; ct0: string } | null {
  let authToken = process.env.X_AUTH_TOKEN || "";
  let ct0 = process.env.X_CT0 || "";
  if ((!authToken || !ct0) && fs.existsSync(AUTH_FILE)) {
    try {
      const arr = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as {
        name: string;
        value: string;
      }[];
      for (const c of arr) {
        if (c.name === "auth_token") authToken = authToken || c.value;
        if (c.name === "ct0") ct0 = ct0 || c.value;
      }
    } catch {
      /* ignore */
    }
  }
  return authToken && ct0 ? { authToken, ct0 } : null;
}

function headers(ct0: string, authToken: string): Record<string, string> {
  return {
    authorization: BEARER,
    "x-csrf-token": ct0,
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
    cookie: `auth_token=${authToken}; ct0=${ct0}`,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  };
}

// The GraphQL mutation id rotates whenever X ships a new bundle, so it is
// discovered from their own JS rather than pinned in config. Cached for the
// process; X_CREATE_TWEET_QUERY_ID overrides if you ever need to pin it.
let cachedQueryId: string | null = null;

export async function discoverCreateTweetQueryId(auth: {
  authToken: string;
  ct0: string;
}): Promise<string | null> {
  if (process.env.X_CREATE_TWEET_QUERY_ID) return process.env.X_CREATE_TWEET_QUERY_ID;
  if (cachedQueryId) return cachedQueryId;

  try {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";
    // The logged-out page only ships a stub bundle; the real client manifest
    // needs a session.
    const html = await (
      await fetch("https://x.com/home", {
        headers: {
          "user-agent": ua,
          accept: "text/html",
          cookie: `auth_token=${auth.authToken}; ct0=${auth.ct0}`,
        },
      })
    ).text();

    const mainUrl = html.match(
      /https:\/\/abs\.twimg\.com\/[^"'\s]*main\.[a-f0-9]+\.js/
    )?.[0];
    if (!mainUrl) return null;

    const js = await (await fetch(mainUrl, { headers: { "user-agent": ua } })).text();
    const id =
      js.match(/queryId:"([A-Za-z0-9_-]{10,})",operationName:"CreateTweet"/)?.[1] ||
      js.match(/operationName:"CreateTweet",[^}]*?queryId:"([A-Za-z0-9_-]{10,})"/)?.[1];

    if (id) {
      cachedQueryId = id;
      console.log(`[x-reply] discovered CreateTweet queryId ${id}`);
    }
    return id || null;
  } catch {
    return null;
  }
}

export type ReplyResult =
  | { ok: true; tweetId: string; via: "v1.1" | "graphql" }
  | { ok: false; error: string; status?: number };

/** Normalized form used to catch the same reply being sent to many people. */
export function replyFingerprint(text: string): string {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export function sessionReady(): boolean {
  return !!loadAuth();
}

/** Health check: proves the session can read X's bundle and find the mutation. */
export async function replyPathReady(): Promise<{ ok: boolean; queryId?: string }> {
  const auth = loadAuth();
  if (!auth) return { ok: false };
  const id = await discoverCreateTweetQueryId(auth);
  return id ? { ok: true, queryId: id } : { ok: false };
}

async function viaV11(
  auth: { authToken: string; ct0: string },
  inReplyTo: string,
  text: string
): Promise<ReplyResult> {
  const body = new URLSearchParams({
    status: text,
    in_reply_to_status_id: inReplyTo,
    auto_populate_reply_metadata: "true",
    tweet_mode: "extended",
  });

  const res = await fetch("https://x.com/i/api/1.1/statuses/update.json", {
    method: "POST",
    headers: {
      ...headers(auth.ct0, auth.authToken),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const raw = await res.text();
  if (!res.ok)
    return {
      ok: false,
      error: raw.slice(0, 300) || `empty response (${res.status})`,
      status: res.status,
    };
  try {
    const j = JSON.parse(raw);
    return { ok: true, tweetId: String(j.id_str || j.id || ""), via: "v1.1" };
  } catch {
    return { ok: false, error: "unparseable response", status: res.status };
  }
}

async function viaGraphql(
  auth: { authToken: string; ct0: string },
  inReplyTo: string,
  text: string
): Promise<ReplyResult> {
  const queryId = await discoverCreateTweetQueryId(auth);
  if (!queryId) {
    return {
      ok: false,
      error:
        "Could not read X's CreateTweet mutation id from their web bundle. Your session may have expired — refresh X_AUTH_TOKEN and X_CT0.",
    };
  }

  const res = await fetch(`https://x.com/i/api/graphql/${queryId}/CreateTweet`, {
    method: "POST",
    headers: { ...headers(auth.ct0, auth.authToken), "content-type": "application/json" },
    body: JSON.stringify({
      variables: {
        tweet_text: text,
        reply: { in_reply_to_tweet_id: inReplyTo, exclude_reply_user_ids: [] },
        dark_request: false,
        media: { media_entities: [], possibly_sensitive: false },
        semantic_annotation_ids: [],
      },
      features: {
        tweetypie_unmention_optimization_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: false,
        tweet_awards_web_tipping_enabled: false,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_enhance_cards_enabled: false,
      },
      queryId,
    }),
  });

  const raw = await res.text();
  if (!res.ok) return { ok: false, error: raw.slice(0, 300), status: res.status };
  try {
    const j = JSON.parse(raw);
    const id = j?.data?.create_tweet?.tweet_results?.result?.rest_id;
    if (!id) return { ok: false, error: raw.slice(0, 300), status: res.status };
    return { ok: true, tweetId: String(id), via: "graphql" };
  } catch {
    return { ok: false, error: "unparseable response", status: res.status };
  }
}

export async function postReply(inReplyTo: string, text: string): Promise<ReplyResult> {
  const auth = loadAuth();
  if (!auth) {
    return { ok: false, error: "No X session — set X_AUTH_TOKEN and X_CT0 in .env" };
  }

  // GraphQL first: it is what x.com itself posts with. The v1.1 write endpoints
  // have been retired and now return an empty error body, which is useless to
  // show a user.
  const first = await viaGraphql(auth, inReplyTo, text);
  if (first.ok) return first;

  if (first.status === 401 || first.status === 403) {
    return {
      ok: false,
      error: `X session rejected (${first.status}) — refresh X_AUTH_TOKEN/X_CT0`,
      status: first.status,
    };
  }

  const second = await viaV11(auth, inReplyTo, text);
  if (second.ok) return second;

  const detail = [
    first.error && `graphql: ${first.error}`,
    second.error && `v1.1 (${second.status}): ${second.error}`,
  ]
    .filter(Boolean)
    .join(" | ");
  return { ok: false, error: detail || "X rejected the reply", status: first.status };
}
