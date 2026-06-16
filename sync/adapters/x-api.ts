import fs from "node:fs";
import path from "node:path";
import { extFromMime, saveMedia, MAX_BYTES } from "../media";
import { existingAvatar, saveAvatarFromUrl } from "../avatars";
import type {
  Adapter,
  AdapterStatus,
  InboundMessage,
  MediaType,
  OutboundMedia,
  SentMessage,
} from "./types";

/* Browser-free X *classic* DMs via the private 1.1 dm API, authed with the
   auth_token + ct0 cookies the extension/login already capture. No Chromium, so
   it's cheap to run many accounts. NOTE: this reads classic Twitter DMs, NOT the
   E2E-encrypted XChat product (/i/chat) — that still needs the browser driver.
   Select with X_DRIVER=api. */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Public web-app bearer token (shipped in x.com's JS — not a secret).
const BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const AUTH_FILE = path.join(process.cwd(), ".x_auth", "cookies.json");

function loadAuth(): { authToken: string; ct0: string } | null {
  let authToken = process.env.X_AUTH_TOKEN || "";
  let ct0 = process.env.X_CT0 || "";
  if ((!authToken || !ct0) && fs.existsSync(AUTH_FILE)) {
    try {
      const arr = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as any[];
      for (const c of arr) {
        if (c.name === "auth_token") authToken = authToken || c.value;
        if (c.name === "ct0") ct0 = ct0 || c.value;
      }
    } catch {
      /* ignore */
    }
  }
  if (authToken && ct0) return { authToken, ct0 };
  return null;
}

const API = "https://x.com/i/api/1.1";

interface XApiOpts {
  proxyUrl?: string;
}

export class XApiAdapter implements Adapter {
  platform = "x" as const;
  private state: AdapterStatus["state"] = "starting";
  private detail?: string;
  private auth?: { authToken: string; ct0: string };
  private myId = "";
  private cursor?: string;
  private timer?: ReturnType<typeof setInterval>;
  private onMessage?: (m: InboundMessage) => Promise<void>;
  private busy = false;
  // Last seen message id per conversation, for mark_read.
  private lastEvent = new Map<string, string>();

  constructor(_opts: XApiOpts = {}) {
    // TODO(proxy): per-account proxy needs an undici ProxyAgent dispatcher on
    // fetch (global fetch ignores `agent`). Omitted for now.
    void _opts;
  }

  getStatus(): AdapterStatus {
    return { platform: "x", state: this.state, detail: this.detail };
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const a = this.auth!;
    return {
      authorization: BEARER,
      "x-csrf-token": a.ct0,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      cookie: `auth_token=${a.authToken}; ct0=${a.ct0}`,
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
      ...extra,
    };
  }

  private async api(url: string, init: any = {}): Promise<any> {
    const res = await fetch(url, {
      ...init,
      headers: { ...this.headers(init.headers || {}) },
    });
    if (res.status === 401 || res.status === 403) {
      this.state = "disconnected";
      throw new Error(`x api auth failed (${res.status}) — refresh X_AUTH_TOKEN/X_CT0`);
    }
    if (!res.ok) throw new Error(`x api ${res.status} ${url}`);
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
  }

  async start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void> {
    this.onMessage = onMessage;
    this.auth = loadAuth() || undefined;
    if (!this.auth) {
      this.state = "disconnected";
      console.log(
        "[x:api] no session — set X_AUTH_TOKEN + X_CT0 (from the extension / your browser cookies)."
      );
      return;
    }
    try {
      // The inbox fetch doubles as the connectivity + identity check — there's
      // no working verify_credentials endpoint for cookie auth, so we derive
      // "me" from the inbox itself.
      await this.backfill();
    } catch (e) {
      this.state = "disconnected";
      console.error("[x:api] connect failed:", e);
      return;
    }

    const everyMs = Number(process.env.X_POLL_MS || 20000);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.poll().catch((e) => console.error("[x:api] poll error:", e));
    }, everyMs);
  }

  private async fetchInbox(): Promise<any> {
    const url =
      `${API}/dm/inbox_initial_state.json?` +
      [
        "include_quality=all",
        "include_groups=true",
        "include_inbox_timelines=true",
        "include_ext_media_color=true",
        "supports_reactions=true",
        "dm_users=true",
        "include_conversation_info=true",
      ].join("&");
    const data = await this.api(url);
    return data.inbox_initial_state || {};
  }

  private async backfill(): Promise<void> {
    const block = await this.fetchInbox();
    this.myId = deriveMyId(block.conversations || {});
    const me = (block.users || {})[this.myId];
    this.detail = me?.screen_name ? "@" + me.screen_name : undefined;
    this.state = "ready";
    console.log(
      `[x:api] live ${this.detail || "(id " + this.myId + ")"} — ${
        Object.keys(block.conversations || {}).length
      } conversations`
    );
    await this.ingest(block);
    if (block.cursor) this.cursor = block.cursor;
  }

  // user_updates.json is retired; re-poll the inbox (dedupe handles repeats).
  private async poll(): Promise<void> {
    if (this.busy || this.state !== "ready") return;
    this.busy = true;
    try {
      const block = await this.fetchInbox();
      await this.ingest(block);
      if (block.cursor) this.cursor = block.cursor;
    } finally {
      this.busy = false;
    }
  }

  // Parse an inbox/user_events block (conversations + users + entries) and feed
  // each 1:1 DM message to the store.
  private async ingest(block: any): Promise<void> {
    if (!block || !this.onMessage) return;
    const users: Record<string, any> = block.users || {};
    const conversations: Record<string, any> = block.conversations || {};
    const entries: any[] = block.entries || [];

    // entries arrive newest-first; persist oldest-first so ordering is natural.
    for (const entry of [...entries].reverse()) {
      const m = entry.message;
      if (!m) continue;
      const md = m.message_data || {};
      const convId: string = m.conversation_id || md.conversation_id;
      if (!convId) continue;
      const conv = conversations[convId];
      // 1:1 only — skip group DMs for now.
      if (conv && conv.type && conv.type !== "ONE_TO_ONE") continue;
      const senderId = String(md.sender_id || "");
      const direction: "in" | "out" = senderId === this.myId ? "out" : "in";

      // The other participant drives the contact identity.
      let otherId = "";
      if (conv?.participants?.length) {
        const other = conv.participants.find(
          (p: any) => String(p.user_id) !== this.myId
        );
        otherId = String(other?.user_id || "");
      }
      if (!otherId) otherId = direction === "in" ? senderId : String(md.recipient_id || "");
      const u = users[otherId] || {};

      const avatarKey = `x_${convId}`;
      let avatarUrl = existingAvatar(avatarKey) || undefined;
      const pic = u.profile_image_url_https;
      if (!avatarUrl && pic) {
        avatarUrl =
          (await saveAvatarFromUrl(avatarKey, pic.replace("_normal", "_400x400"))) ||
          undefined;
      }

      const im: InboundMessage = {
        platform: "x",
        chatExternalId: convId,
        messageExternalId: `x:${md.id || m.id}`,
        direction,
        body: typeof md.text === "string" ? md.text : "",
        timestamp: new Date(Number(md.time || m.time || Date.now())),
        contact: {
          externalKey: `x:${convId}`,
          name: u.name || u.screen_name || "X user",
          handle: u.screen_name ? "@" + u.screen_name : convId,
          avatarUrl,
        },
      };

      const att = md.attachment;
      const mt = mediaTypeFromAttachment(att);
      if (mt && att) {
        im.media = { type: mt, url: await this.saveAttachment(im.messageExternalId, att, mt) };
      }

      this.lastEvent.set(convId, String(md.id || m.id));
      try {
        await this.onMessage(im);
      } catch (e) {
        console.error("[x:api] persist error:", e);
      }
    }
  }

  private async saveAttachment(
    key: string,
    att: any,
    mt: MediaType
  ): Promise<string | null> {
    const node = att.photo || att.video || att.animated_gif || att.media;
    const u = node?.media_url_https || node?.media_url;
    if (!u) return null;
    try {
      const res = await fetch(u, { headers: this.headers() as any });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) return null;
      const ext = extFromMime(res.headers.get("content-type") || "", mt === "image" ? "jpg" : "mp4");
      return saveMedia(key, ext, buf);
    } catch {
      return null;
    }
  }

  async send(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia
  ): Promise<SentMessage> {
    if (this.state !== "ready") throw new Error("X (api) not ready");
    let mediaId = "";
    if (media) mediaId = await this.uploadMedia(media);

    const reqId =
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const params = new URLSearchParams({
      conversation_id: chatExternalId,
      text: body || "",
      request_id: reqId,
      cards_platform: "Web-12",
      include_cards: "1",
      include_quote_count: "true",
      dm_users: "false",
    });
    if (mediaId) params.set("media_id", mediaId);

    const data = await this.api(`${API}/dm/new2.json`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    // Pull the created message id back out of the response when present.
    let id = reqId;
    try {
      const entries: any[] = data?.entries || [];
      const created = entries.find((e) => e.message)?.message?.message_data?.id;
      if (created) id = String(created);
    } catch {
      /* fall back to request id */
    }
    return { messageExternalId: `x:${id}`, timestamp: new Date().toISOString() };
  }

  // Simple (non-chunked) upload — fine for images/gifs; large videos need the
  // chunked INIT/APPEND/FINALIZE flow (TODO) or the browser driver.
  private async uploadMedia(media: OutboundMedia): Promise<string> {
    const buf = fs.readFileSync(media.path);
    const form = new URLSearchParams({ media_data: buf.toString("base64") });
    const res = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
      method: "POST",
      headers: {
        ...this.headers({ "content-type": "application/x-www-form-urlencoded" }),
      } as any,
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`x media upload failed (${res.status})`);
    const j: any = await res.json();
    return String(j.media_id_string || j.media_id);
  }

  async markRead(chatExternalId: string): Promise<void> {
    if (this.state !== "ready") return;
    const last = this.lastEvent.get(chatExternalId);
    if (!last) return;
    const params = new URLSearchParams({
      conversationId: chatExternalId,
      last_read_event_id: last,
    });
    await this.api(
      `${API}/dm/conversation/${chatExternalId}/mark_read.json`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      }
    ).catch(() => {});
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

function mediaTypeFromAttachment(att: any): MediaType | null {
  if (!att) return null;
  if (att.photo) return "image";
  if (att.video) return "video";
  if (att.animated_gif) return "video";
  return null;
}

// "me" is the user present in (almost) every 1:1 conversation. Count user-id
// frequency across ONE_TO_ONE conversations; the most common is us. (There's no
// working cookie-auth verify_credentials endpoint to ask X directly.)
function deriveMyId(conversations: Record<string, any>): string {
  const freq = new Map<string, number>();
  for (const conv of Object.values(conversations)) {
    if (conv?.type && conv.type !== "ONE_TO_ONE") continue;
    let ids: string[] = [];
    if (Array.isArray(conv?.participants))
      ids = conv.participants.map((p: any) => String(p.user_id)).filter(Boolean);
    else if (typeof conv?.conversation_id === "string")
      ids = conv.conversation_id.split("-");
    for (const id of ids) freq.set(id, (freq.get(id) || 0) + 1);
  }
  let me = "";
  let best = -1;
  for (const [id, c] of freq) {
    if (c > best) {
      best = c;
      me = id;
    }
  }
  return me;
}
