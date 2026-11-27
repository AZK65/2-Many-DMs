import type { Adapter, AdapterStatus, InboundMessage, InboundReaction, OutboundMedia, OutboundSendContext, SentMessage } from "./types";
import { XAdapter } from "./x";
import { XMautrixAdapter } from "./x-mautrix";
import { MautrixError } from "../x-mautrix-process";
import type { XUnlockState } from "../../src/lib/x-unlock-state";

type Unlockable = Adapter & { unlockChat(pin: string): Promise<XUnlockState> };

/** Only ONE connector owns X at a time. An uncertain send is never retried. */
export class XHybridAdapter implements Adapter {
  platform = "x" as const;
  private primary: Unlockable;
  private active: Unlockable;
  private fallback?: Unlockable;
  private switching?: Promise<void>;
  private stopped = false;
  private callbacks?: Parameters<Adapter["start"]>;
  private sending = 0;
  private fallbackPending = false;
  private idleWaiters: (() => void)[] = [];
  constructor(private options: { accountId: string; session?: { authToken: string; ct0: string };
    primary?: Unlockable; browserFactory?: () => Unlockable }) {
    this.primary = options.primary || new XMautrixAdapter({ ...options, onFailure: () => {
      this.fallbackPending = true;
      if (!this.sending) void this.useBrowser().catch(() => {});
    } });
    this.active = this.primary;
  }
  async start(onMessage: (message: InboundMessage) => Promise<void>, onRead?: (id: string) => Promise<void>, onReaction?: (reaction: InboundReaction) => Promise<void>) {
    this.callbacks = [onMessage, onRead, onReaction];
    try { await this.primary.start(...this.callbacks); }
    catch { await this.useBrowser(); }
  }
  async useBrowser() {
    if (this.switching) return this.switching;
    if (this.stopped || this.active !== this.primary || !this.callbacks) return;
    this.switching = (async () => {
      if (this.sending) await new Promise<void>(resolve => this.idleWaiters.push(resolve));
      // Wait for process shutdown before opening the saved browser session.
      await this.primary.stop();
      if (this.stopped) return;
      this.fallback = this.options.browserFactory?.() || new XAdapter(this.options);
      this.active = this.fallback;
      await this.fallback.start(...this.callbacks!);
      if (this.stopped) await this.fallback.stop();
      this.fallbackPending = false;
    })().finally(() => { this.switching = undefined; });
    return this.switching;
  }
  async unlockChat(pin: string) { if (this.switching) await this.switching; return this.active.unlockChat(pin); }
  async send(chat: string, body: string, media?: OutboundMedia, mentions?: string[], reply?: string, context?: OutboundSendContext): Promise<SentMessage> {
    if (this.switching && this.active === this.primary) await this.switching;
    // This pilot routes unsupported operations before a send is attempted.
    if (this.active === this.primary && (media || mentions?.length || reply)) await this.useBrowser();
    this.sending++;
    try { return await this.active.send(chat, body, media, mentions, reply, context); }
    catch (error) {
      // No retry here, even for network failures. The worker keeps ambiguous
      // delivery visible so the user can inspect X before another send.
      if (error instanceof MautrixError && error.uncertain) this.fallbackPending = true;
      throw error;
    } finally {
      this.sending--;
      if (!this.sending) this.idleWaiters.splice(0).forEach(resolve => resolve());
      if (this.fallbackPending && !this.sending) void this.useBrowser().catch(() => {});
    }
  }
  refreshRecent(chat: string, context?: OutboundSendContext) { this.active.refreshRecent?.(chat, context); }
  async requestHistory(...args: Parameters<NonNullable<Adapter["requestHistory"]>>) { await this.active.requestHistory?.(...args); }
  async markRead(...args: Parameters<NonNullable<Adapter["markRead"]>>) { await this.active.markRead?.(...args); }
  async refreshAvatar(...args: Parameters<NonNullable<Adapter["refreshAvatar"]>>) { return this.active.refreshAvatar ? this.active.refreshAvatar(...args) : { source: "unavailable" as const }; }
  async editMessage(...args: Parameters<NonNullable<Adapter["editMessage"]>>) { await this.useBrowser(); if (!this.active.editMessage) throw new Error("Editing is unavailable"); await this.active.editMessage(...args); }
  async deleteMessage(...args: Parameters<NonNullable<Adapter["deleteMessage"]>>) { await this.useBrowser(); if (!this.active.deleteMessage) throw new Error("Deleting is unavailable"); await this.active.deleteMessage(...args); }
  async recoverMedia(...args: Parameters<NonNullable<Adapter["recoverMedia"]>>) { await this.useBrowser(); if (!this.active.recoverMedia) throw new Error("Attachment recovery is unavailable"); await this.active.recoverMedia(...args); }
  getStatus(): AdapterStatus {
    const status = this.active.getStatus();
    return { ...status, ...(this.switching && this.active === this.primary ? { state: "starting" as const } : {}),
      detail: this.active === this.primary ? status.detail : `Using the saved browser connection. ${status.detail || ""}`.trim() };
  }
  async stop() { this.stopped = true; await this.primary.stop(); if (this.switching) await this.switching; if (this.fallback) await this.fallback.stop(); }
}
