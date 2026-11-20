import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Adapter } from "./adapters/types";
import { DurableRecords } from "./retention";
import { groupContactScope, groupMemberPolicy, MAX_GROUP_ADDITIONS, normalizeMemberTarget, type MemberResult, type MemberSelection } from "../src/lib/group-membership";
import type { Platform } from "../src/lib/platforms";
import { membershipError } from "./group-member-transports";

type Request = { userId: string; conversationId: string; requestId: string; selections: MemberSelection[] };
type Receipt = { fingerprint: string; results?: MemberResult[] };
type Ledger = Pick<DurableRecords<Receipt>, "get" | "put">;

export class GroupMembership {
  private active = new Map<string, Promise<MemberResult[]>>();
  private locked = new Set<string>();
  constructor(private db: PrismaClient, private adapterFor: (id: string) => Adapter | undefined,
    private run: <T>(adapter: Adapter, task: () => Promise<T>) => Promise<T>,
    private ledger: Ledger = new DurableRecords(path.join(process.env.DATA_DIR || process.cwd(), ".local", "group-additions"))) {}

  private async context(userId: string, conversationId: string) {
    if (typeof userId !== "string" || typeof conversationId !== "string") throw new Error("Choose a group in this workspace.");
    const chat = await this.db.conversation.findFirst({ where: { id: conversationId, account: { userId }, contact: { isGroup: true } }, include: { account: true } });
    if (!chat?.accountId || !chat.account || !chat.externalId || chat.platform !== chat.account.platform) throw new Error("Group not found in this workspace.");
    if (!groupMemberPolicy(chat.platform as Platform)?.direct) throw new Error("Finish adding people in the native app for this platform.");
    const adapter = this.adapterFor(chat.accountId);
    if (!adapter?.addGroupMember || adapter.platform !== chat.platform || adapter.getStatus().state !== "ready") throw new Error("Reconnect this group's account in Settings before adding people.");
    return { chat, adapter };
  }

  async resolve(input: { userId: string; conversationId: string; target: string }) {
    if (!input) throw new Error("Enter an exact person to look up.");
    const { chat, adapter } = await this.context(input.userId, input.conversationId);
    if (typeof input.target !== "string" || !adapter.resolveDirectContact) throw new Error("Enter an exact person to look up.");
    const target = normalizeMemberTarget(chat.platform as Platform, input.target);
    const person = await this.run(adapter, () => adapter.resolveDirectContact!(target));
    if (!person.externalKey.startsWith(`${chat.platform}:`)) throw new Error("The platform could not verify this person.");
    return { target, expectedKey: person.externalKey, name: person.name, handle: person.handle };
  }

  async execute(input: Request): Promise<MemberResult[]> {
    if (!input || typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId) || !Array.isArray(input.selections) || !input.selections.length || input.selections.length > MAX_GROUP_ADDITIONS) throw new Error(`Choose 1–${MAX_GROUP_ADDITIONS} people.`);
    for (const entry of input.selections) {
      if (!entry || typeof entry !== "object" || ("contactId" in entry
        ? typeof entry.contactId !== "string" || entry.contactId.length > 100
        : !("target" in entry) || typeof entry.target !== "string" || entry.target.length > 200 || typeof entry.expectedKey !== "string" || entry.expectedKey.length > 200)) throw new Error("Invalid person selection.");
    }
    const { chat, adapter } = await this.context(input.userId, input.conversationId);
    const fingerprint = createHash("sha256").update(JSON.stringify(input.selections)).digest("hex");
    const key = `${input.userId}:${chat.accountId}:${chat.id}:${input.requestId}`;
    const saved = this.ledger.get(key);
    if (saved && saved.fingerprint !== fingerprint) throw new Error("This request was already used for a different selection.");
    if (this.active.has(key)) return this.active.get(key)!;
    if (saved?.results) return saved.results;
    if (saved) throw new Error("This addition was interrupted. Check membership in the native app before trying again; it was not automatically repeated.");
    const lock = `${chat.accountId}:${chat.externalId!.replace(/__t\d+$/, "")}`;
    if (this.locked.has(lock)) throw new Error("Another addition is still running for this group. Wait before trying again.");
    this.locked.add(lock);
    const task = this.perform(input, chat, adapter, key, fingerprint).finally(() => { this.active.delete(key); this.locked.delete(lock); });
    this.active.set(key, task);
    return task;
  }

  private async perform(input: Request, chat: { accountId: string | null; platform: string; externalId: string | null }, adapter: Adapter, key: string, fingerprint: string) {
    const ids = [...new Set(input.selections.flatMap(s => "contactId" in s ? [s.contactId] : []))];
    const contacts = await this.db.contact.findMany({ where: { ...groupContactScope(chat.accountId!, chat.platform), id: { in: ids } } });
    if (contacts.length !== ids.length) throw new Error("A selected contact does not belong to this connected account. Choose them again.");
    this.ledger.put(key, { fingerprint }); // Durable intent before any external addition.
    const results: MemberResult[] = [];
    await this.run(adapter, async () => {
      const seen = new Set<string>();
      let stopped = false;
      for (const selection of input.selections) {
        const contact = "contactId" in selection ? contacts.find(c => c.id === selection.contactId)! : null;
        const name = contact?.name || ("target" in selection ? selection.target : "Contact");
        let externalKey = contact?.externalKey || ("expectedKey" in selection ? selection.expectedKey : "");
        if (stopped) { results.push({ key: externalKey, name, status: "not_added", detail: "Not attempted because a previous addition needs attention." }); continue; }
        if (seen.has(externalKey)) continue;
        seen.add(externalKey);
        try {
          if (!contact && "target" in selection) {
            if (!adapter.resolveDirectContact) throw new Error("Lookup unavailable");
            const person = await adapter.resolveDirectContact(normalizeMemberTarget(chat.platform as Platform, selection.target));
            if (person.externalKey !== selection.expectedKey) {
              results.push({ key: externalKey, name, status: "not_added", detail: "This username now points to a different person. Look it up again." }); continue;
            }
            externalKey = person.externalKey;
          }
          const outcome = await adapter.addGroupMember!(chat.externalId!, externalKey);
          results.push({ key: externalKey, name, ...outcome });
          stopped = outcome.status === "unknown" || /asked you to wait/.test(outcome.detail);
        } catch (error) {
          const outcome = membershipError(error);
          results.push({ key: externalKey, name, ...outcome });
          stopped = outcome.status === "unknown" || /asked you to wait/.test(outcome.detail);
        }
      }
    });
    this.ledger.put(key, { fingerprint, results });
    return results;
  }
}
