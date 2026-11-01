import type { PrismaClient } from "@prisma/client";
import type { Adapter } from "./adapters/types";
import { messageMutationPolicy, type MessageMutationAction } from "../src/lib/message-mutations";

export type MutationInput = { conversationId: string; messageId: string; userId: string; requestId: string;
  action: MessageMutationAction; expectedBody: string; expectedEditedAt: string | null; body?: string };

export class MessageMutations {
  private running = new Map<string, Promise<unknown>>();
  constructor(private db: PrismaClient, private adapterFor: (id: string) => Adapter | undefined,
    private withConnector: <T>(adapter: Adapter, task: () => Promise<T>) => Promise<T>) {}

  async execute(input: MutationInput) {
    if (!input || !["edit", "delete"].includes(input.action) || typeof input.expectedBody !== "string" ||
        ![input.conversationId, input.messageId, input.userId, input.requestId].every(v => typeof v === "string" && v.length > 0 && v.length < 200) ||
        !(input.expectedEditedAt === null || typeof input.expectedEditedAt === "string")) throw new Error("Invalid message action.");
    const key = `${input.userId}:${input.conversationId}:${input.messageId}:${input.requestId}`;
    const existing = this.running.get(key);
    if (existing) return existing;
    const operation = this.perform(input);
    this.running.set(key, operation);
    try { return await operation; }
    finally { this.running.delete(key); }
  }

  private async perform(input: MutationInput) {
    const message = await this.db.message.findFirst({ where: { id: input.messageId, conversationId: input.conversationId },
      include: { conversation: { include: { account: true } } } });
    const conversation = message?.conversation;
    const account = conversation?.account;
    if (!message || !account || account.userId !== input.userId || !conversation?.externalId || account.platform !== conversation.platform)
      throw new Error("Message or connected account not found in this workspace.");
    if (message.mutationRequestId === input.requestId && !message.mutationState) return this.snapshot(message.id);
    const policy = messageMutationPolicy(account.platform, account.driver, message);
    if (!policy[input.action]) throw new Error(message.mutationState
      ? "The previous action is still unconfirmed. Check the native app before making another change."
      : "This message cannot be changed here. It may be outside the platform's time limit.");
    if (message.body !== input.expectedBody || (message.editedAt?.toISOString() ?? null) !== input.expectedEditedAt)
      throw new Error("This message changed while the editor was open. Close the editor and try again.");
    if (input.action === "edit" && (typeof input.body !== "string" || !input.body.trim() || input.body.length > policy.maxLength))
      throw new Error(`Enter a message of at most ${policy.maxLength.toLocaleString()} characters.`);
    if (input.action === "edit" && input.body === message.body) return this.snapshot(message.id);
    const adapter = this.adapterFor(account.id); // Never fall back to another account.
    if (!adapter || adapter.platform !== account.platform || adapter.getStatus().state !== "ready" ||
        (input.action === "edit" ? !adapter.editMessage : !adapter.deleteMessage))
      throw new Error("This connection is not ready for that action. Reconnect it first.");
    // Atomic claim protects against two tabs, concurrent actions and restarts.
    const claimed = await this.db.message.updateMany({ where: { id: message.id, mutationState: null, deletedAt: null,
      body: input.expectedBody, editedAt: message.editedAt }, data: { mutationState: "pending", mutationRequestId: input.requestId } });
    if (claimed.count !== 1) throw new Error("Another action is already changing this message. Wait for it to finish.");
    try {
      await this.withConnector(adapter, () => input.action === "edit"
        ? adapter.editMessage!(conversation.externalId!, message.externalKey!, input.body!)
        : adapter.deleteMessage!(conversation.externalId!, message.externalKey!));
      const deleted = input.action === "delete";
      await this.db.$transaction(async tx => {
        await tx.message.update({ where: { id: message.id }, data: {
          body: deleted ? "Message deleted" : input.body!,
          editedAt: deleted ? message.editedAt : new Date(), deletedAt: deleted ? new Date() : null,
          mutationState: null, originalBody: null, translatedBody: null,
          translationSourceLanguage: null, translationTargetLanguage: null,
          ...(deleted ? { mediaType: null, mediaUrl: null, mediaName: null, mediaIsGif: false, pinnedAt: null,
            ocrText: null, ocrStatus: "skipped", replyToExternalKey: null, replyPreview: null, replySender: null } : {}),
        } });
        // Cached quotes and searchable email captures must not retain removed text.
        await tx.message.updateMany({ where: { conversationId: conversation.id, replyToExternalKey: message.externalKey },
          data: { replyPreview: deleted ? "Message deleted" : input.body!.slice(0, 300) } });
        await tx.emailCapture.deleteMany({ where: { messageId: message.id } });
        if (deleted) {
          await tx.reaction.deleteMany({ where: { messageId: message.id } });
          await tx.keywordAlertHit.deleteMany({ where: { messageId: message.id } });
        }
      });
      return this.snapshot(message.id);
    } catch (error) {
      // A transport failure is not proof that the platform rejected the change.
      // Do not replay it automatically, or claim a local-only delete was remote.
      await this.db.message.updateMany({ where: { id: message.id, mutationRequestId: input.requestId, mutationState: "pending" },
        data: { mutationState: "uncertain" } });
      throw new Error(`The platform action could not be confirmed. Check the native app; it will not be retried automatically. ${error instanceof Error ? error.message : ""}`);
    }
  }

  private async snapshot(id: string) {
    const { conversationId: _conversationId, mutationRequestId: _requestId, ...message } = await this.db.message.findUniqueOrThrow({ where: { id } });
    return { ...message, ...(message.deletedAt ? { reactions: [] } : {}) };
  }
}
