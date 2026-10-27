import fs from "node:fs";
import path from "node:path";
import { extFromMime, saveMedia, MAX_BYTES } from "../media";
import type { Adapter, AdapterStatus, InboundMessage, OutboundMedia, SentMessage } from "./types";

type GmailSession = { refreshToken: string; email: string };
type Header = { name: string; value: string };
type ThreadMeta = { to: string; subject: string; messageId?: string; references?: string };

const decode = (value = "") => Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const encode = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const header = (headers: Header[] = [], name: string) => headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || "";
const address = (value: string) => value.match(/<([^>]+)>/)?.[1] || value.split(",")[0]?.trim() || value;
const displayName = (value: string) => value.replace(/<[^>]+>/, "").replace(/^"|"$/g, "").trim() || address(value);
const addresses = (value: string) =>
  value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
const htmlToText = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function textPart(part: any): string {
  if (part?.mimeType === "text/plain" && part.body?.data) return decode(part.body.data).toString("utf8").trim();
  for (const child of part?.parts || []) { const text = textPart(child); if (text) return text; }
  if (part?.mimeType === "text/html" && part.body?.data) return htmlToText(decode(part.body.data).toString("utf8"));
  return "";
}

export class GmailAdapter implements Adapter {
  platform = "gmail" as const;
  private state: AdapterStatus["state"] = "starting";
  private accessToken = "";
  private accessExpiresAt = 0;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private threadMeta = new Map<string, ThreadMeta>();
  private onMessage?: (message: InboundMessage) => Promise<void>;

  constructor(private session: GmailSession) {}

  getStatus(): AdapterStatus { return { platform: "gmail", state: this.state, detail: this.session.email }; }

  async ensureReady(): Promise<void> {
    if (this.stopped) throw new Error("Gmail is disconnected");
    await this.token();
    this.state = "ready";
  }

  async recover(): Promise<void> {
    this.accessToken = "";
    this.accessExpiresAt = 0;
    this.state = "starting";
    await this.ensureReady();
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessExpiresAt - 60_000) return this.accessToken;
    const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google OAuth credentials are missing");
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: this.session.refreshToken, grant_type: "refresh_token" }) });
    const data: any = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || "Gmail token refresh failed");
    this.accessToken = data.access_token; this.accessExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  private async api(endpoint: string, init: RequestInit = {}): Promise<any> {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${endpoint}`, { ...init, headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json", ...(init.headers || {}) } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Gmail API ${response.status}`);
    return data;
  }

  private async attachment(messageId: string, id: string, mime: string, externalKey: string): Promise<string | null> {
    const data = await this.api(`/messages/${messageId}/attachments/${id}`);
    const buffer = decode(data.data);
    if (buffer.length > MAX_BYTES) return null;
    return saveMedia(externalKey, extFromMime(mime, "bin"), buffer);
  }

  private async ingestThread(threadId: string, recoverMessageId?: string): Promise<void> {
    const thread = await this.api(`/threads/${threadId}?format=full`);
    const messages: any[] = thread.messages || [];
    const participantEmails = [...new Set(messages.flatMap((message) => {
      const headers: Header[] = message.payload?.headers || [];
      return ["From", "To", "Cc"]
        .flatMap((name) => addresses(header(headers, name)))
        .map((email) => email.toLowerCase())
        .filter((email) => email !== this.session.email.toLowerCase());
    }))];
    const isGroupThread = participantEmails.length > 1;
    for (const message of messages) {
      if (recoverMessageId && message.id !== recoverMessageId) continue;
      const headers: Header[] = message.payload?.headers || [];
      const from = header(headers, "From"), to = header(headers, "To"), subject = header(headers, "Subject") || "No subject";
      const outgoing = address(from).toLowerCase() === this.session.email.toLowerCase();
      const other = outgoing ? to : from;
      const otherEmail = address(other);
      const replyRecipients = isGroupThread ? participantEmails.join(", ") : otherEmail;
      this.threadMeta.set(threadId, { to: replyRecipients, subject, messageId: header(headers, "Message-ID"), references: header(headers, "References") });
      const externalKey = `gmail:${message.id}`;
      const inbound: InboundMessage = {
        platform: "gmail", chatExternalId: threadId, messageExternalId: externalKey,
        direction: outgoing ? "out" : "in", body: textPart(message.payload) || message.snippet || "",
        timestamp: new Date(Number(message.internalDate || Date.now())),
        contact: {
          externalKey: `gmail:${threadId}`,
          name: isGroupThread ? subject : displayName(other),
          handle: isGroupThread ? participantEmails.join(", ") : otherEmail,
        },
        isGroup: isGroupThread,
      };
      const findAttachment = (part: any): any => part?.filename && part?.body?.attachmentId ? part : (part?.parts || []).map(findAttachment).find(Boolean);
      const file = findAttachment(message.payload);
      if (file) inbound.media = { type: file.mimeType?.startsWith("image/") ? "image" : file.mimeType?.startsWith("video/") ? "video" : file.mimeType?.startsWith("audio/") ? "audio" : "file", name: file.filename, url: recoverMessageId && Number(file.body?.size || 0) <= MAX_BYTES ? await this.attachment(message.id, file.body.attachmentId, file.mimeType, externalKey).catch(() => null) : null };
      if (recoverMessageId) inbound.historical = true;
      await this.onMessage?.(inbound);
    }
  }

  private async sync(): Promise<void> {
    const list = await this.api(`/threads?maxResults=75&q=${encodeURIComponent("newer_than:90d -in:spam -in:trash")}`);
    for (const thread of list.threads || []) await this.ingestThread(thread.id).catch((error) => console.error("[gmail] thread error", thread.id, error));
  }

  async recoverMedia(threadId: string, messageExternalId: string): Promise<void> {
    await this.ensureReady();
    await this.ingestThread(threadId, messageExternalId.replace(/^gmail:/, ""));
  }

  async start(onMessage: (message: InboundMessage) => Promise<void>): Promise<void> {
    this.onMessage = onMessage; this.stopped = false;
    await this.token(); this.state = "ready"; console.log(`[gmail] live ${this.session.email}`);
    const tick = async () => { if (this.stopped) return; await this.sync().catch((error) => { this.state = "starting"; console.error("[gmail] sync error", error); }); if (!this.stopped) this.timer = setTimeout(tick, 15_000); };
    void tick();
  }

  async send(threadId: string, body: string, media?: OutboundMedia): Promise<SentMessage> {
    await this.ensureReady();
    if (!this.threadMeta.has(threadId)) await this.ingestThread(threadId);
    const meta = this.threadMeta.get(threadId);
    if (!meta) throw new Error("Gmail thread metadata unavailable");
    const boundary = `tmd_${Date.now().toString(36)}`;
    const replyHeaders = `${meta.messageId ? `In-Reply-To: ${meta.messageId}\r\nReferences: ${[meta.references, meta.messageId].filter(Boolean).join(" ")}\r\n` : ""}`;
    let raw = `From: ${this.session.email}\r\nTo: ${meta.to}\r\nSubject: ${meta.subject}\r\n${replyHeaders}MIME-Version: 1.0\r\n`;
    if (media) {
      raw += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}\r\n--${boundary}\r\nContent-Type: ${media.mime || "application/octet-stream"}; name="${media.name}"\r\nContent-Disposition: attachment; filename="${media.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${fs.readFileSync(path.resolve(media.path)).toString("base64")}\r\n--${boundary}--`;
    } else raw += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`;
    const sent = await this.api("/messages/send", { method: "POST", body: JSON.stringify({ raw: encode(raw), threadId }) });
    return { messageExternalId: `gmail:${sent.id}`, timestamp: new Date().toISOString() };
  }

  async createGroup(
    name: string,
    participantKeys: string[],
    firstMessage?: string
  ): Promise<{
    chatExternalId: string;
    initialMessageSent: boolean;
    participantOutcomes: {
      participantKey: string;
      status: "added";
    }[];
  }> {
    await this.ensureReady();
    const recipients = [...new Set(participantKeys
      .map((value) => value.trim().replace(/^mailto:/i, ""))
      .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    )];
    if (!recipients.length) throw new Error("no valid Gmail recipients");
    if (!firstMessage?.trim()) throw new Error("Gmail needs a first message to start a group email");
    const subject = name.replace(/[\r\n]+/g, " ").trim();
    const raw = [
      `From: ${this.session.email}`,
      `To: ${recipients.join(", ")}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      firstMessage.trim(),
    ].join("\r\n");
    const sent = await this.api("/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: encode(raw) }),
    });
    if (!sent.threadId) throw new Error("Gmail sent the message without returning its thread");
    this.threadMeta.set(sent.threadId, { to: recipients.join(", "), subject });
    return {
      chatExternalId: sent.threadId,
      initialMessageSent: true,
      participantOutcomes: recipients.map((participantKey) => ({
        participantKey,
        status: "added" as const,
      })),
    };
  }

  async markRead(threadId: string): Promise<void> { await this.api(`/threads/${threadId}/modify`, { method: "POST", body: JSON.stringify({ removeLabelIds: ["UNREAD"] }) }); }
  async requestHistory(threadId: string): Promise<void> {
    if (!this.onMessage || this.state !== "ready") throw new Error("Gmail is not ready");
    await this.ingestThread(threadId);
  }
  async stop(): Promise<void> { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.state = "disconnected"; }
}
