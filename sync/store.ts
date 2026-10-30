import { PrismaClient } from "@prisma/client";
import type { InboundMessage, InboundReaction } from "./adapters/types";
import { isPlaceholderIdentity, type WhatsAppIdentity } from "./whatsapp-identity";
import { normalizeXMessageText, richerXMessageText, xPreviewMatchesText } from "./x-message-text";
import { telegramPlaceholderRepair } from "./telegram-message-content";

const X_MEDIA_PREVIEWS: Record<string, string[]> = {
  image: ["Sent a photo", "Sent an image", "Photo", "Image"],
  video: ["Sent a video", "Video"],
  audio: ["Sent a voice message", "Sent an audio message", "Voice message"],
  file: ["Sent a file", "Sent a document", "Sent an attachment", "Attachment"],
};
import { configureSqlite } from "../src/lib/sqlite";

export const prisma = new PrismaClient();
export const prismaReady = configureSqlite(prisma);

let writeQueue: Promise<void> = Promise.resolve();

function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function messagePreview(body: string, mediaType?: string | null): string {
  const text = body.trim();
  if (text) return text;
  switch (mediaType) {
    case "image":
      return "Photo";
    case "video":
      return "Video";
    case "audio":
      return "Voice message";
    case "sticker":
      return "Sticker";
    case "file":
      return "File";
    default:
      return "Message";
  }
}

// Clears the unread badge for a chat after it's been read on the platform
// (e.g. you opened it on your phone). Idempotent.
async function persistReadNow(
  accountId: string,
  chatExternalId: string
): Promise<void> {
  await prisma.conversation.updateMany({
    where: { accountId, externalId: chatExternalId },
    data: { unread: 0, hasUnreadMention: false },
  });
}

// Writes an inbound (or echoed outbound) message into the same DB the UI reads.
// Idempotent: messages are deduped by their platform-unique externalKey, so
// re-running backfill or receiving our own echoed sends won't create duplicates.
async function persistInboundNow(m: InboundMessage): Promise<string | null> {
  const contact = await prisma.contact.upsert({
    where: { externalKey: m.contact.externalKey },
    create: {
      name: m.contact.name,
      handle: m.contact.handle,
      externalKey: m.contact.externalKey,
      avatarUrl: m.contact.avatarUrl,
      isGroup: !!m.isGroup,
    },
    update: {
      // A transient WhatsApp lookup failure must not erase a saved identity.
      ...(m.platform !== "whatsapp" || !isPlaceholderIdentity(m.contact.name)
        ? { name: m.contact.name } : {}),
      handle: m.contact.handle,
      ...(m.isGroup ? { isGroup: true } : {}),
      // Only overwrite the avatar when we actually fetched one.
      ...(m.contact.avatarUrl ? { avatarUrl: m.contact.avatarUrl } : {}),
    },
  });

  // For group messages, resolve the member who sent it (their externalKey
  // matches their 1:1 contact when one exists, so tags are shared).
  let senderContactId: string | undefined;
  if (m.sender) {
    const resolvedSenderName = m.sender.name.trim();
    const sc = await prisma.contact.upsert({
      where: { externalKey: m.sender.externalKey },
      create: {
        name: resolvedSenderName,
        handle: resolvedSenderName,
        externalKey: m.sender.externalKey,
        avatarUrl: m.sender.avatarUrl,
      },
      update: m.sender.avatarUrl ? { avatarUrl: m.sender.avatarUrl } : {},
    });
    // A platform lookup can briefly fail while its entity cache is warming and
    // create a placeholder. Upgrade that placeholder once a later message (or
    // backfill) resolves the real member, without overwriting user-edited names.
    if (
      resolvedSenderName &&
      resolvedSenderName !== "Member" &&
      (sc.name === "Member" || !sc.name.trim() ||
        (m.platform === "whatsapp" && isPlaceholderIdentity(sc.name) && !isPlaceholderIdentity(resolvedSenderName)))
    ) {
      await prisma.contact.update({
        where: { id: sc.id },
        data: {
          name: resolvedSenderName,
          ...(sc.handle === "Member" || !sc.handle.trim() || (m.platform === "whatsapp" && isPlaceholderIdentity(sc.handle))
            ? { handle: resolvedSenderName }
            : {}),
        },
      });
    }
    senderContactId = sc.id;
  }

  for (const mentioned of m.mentionedContacts || []) {
    const resolvedName = mentioned.name.trim();
    if (!resolvedName) continue;
    const saved = await prisma.contact.upsert({
      where: { externalKey: mentioned.externalKey },
      create: {
        name: resolvedName,
        handle: mentioned.handle || resolvedName,
        externalKey: mentioned.externalKey,
        avatarUrl: mentioned.avatarUrl,
      },
      update: mentioned.avatarUrl ? { avatarUrl: mentioned.avatarUrl } : {},
    });
    if (
      resolvedName !== "WhatsApp member" &&
      (saved.name === "WhatsApp member" || !saved.name.trim() ||
        (m.platform === "whatsapp" && isPlaceholderIdentity(saved.name) && !isPlaceholderIdentity(resolvedName)))
    ) {
      await prisma.contact.update({
        where: { id: saved.id },
        data: {
          name: resolvedName,
          ...(saved.handle === "WhatsApp member" || !saved.handle.trim()
            ? { handle: mentioned.handle || resolvedName }
            : {}),
        },
      });
    }
  }

  // Routed per account so two of your own accounts can each hold a chat with
  // the same peer. accountId is injected by the worker per instance. (Prisma
  // can't upsert a compound unique with a nullable member, so find-then-create.)
  const accountId = m.accountId ?? null;
  let conversation = await prisma.conversation.findFirst({
    where: { accountId, externalId: m.chatExternalId },
  });
  if (!conversation) {
    try {
      conversation = await prisma.conversation.create({
        data: {
          platform: m.platform,
          accountId,
          externalId: m.chatExternalId,
          contactId: contact.id,
          lastMessageAt: m.timestamp,
          inboxCategory: m.inboxCategory || "general",
        },
      });
    } catch {
      // Lost a race to a concurrent insert — the unique index held; re-read.
      conversation = await prisma.conversation.findFirst({
        where: { accountId, externalId: m.chatExternalId },
      });
    }
  }
  if (!conversation) throw new Error("could not resolve conversation");

  let replyPreview = m.replyPreview?.trim() || undefined;
  let replySender = m.replySender?.trim() || undefined;
  const replySenderNeedsResolution =
    !replySender || /^\+?\d{7,}$/.test(replySender);
  if (m.replyToExternalKey && (!replyPreview || replySenderNeedsResolution)) {
    const replyTarget = await prisma.message.findUnique({
      where: { externalKey: m.replyToExternalKey },
      select: {
        body: true,
        direction: true,
        mediaType: true,
        senderContact: { select: { externalKey: true, name: true } },
      },
    });
    if (replyTarget) {
      replyPreview ||= messagePreview(replyTarget.body, replyTarget.mediaType);
      if (replySenderNeedsResolution) {
        replySender =
          replyTarget.direction === "out"
            ? "You"
            : replyTarget.senderContact?.externalKey === m.sender?.externalKey &&
                m.sender?.name
              ? m.sender.name
              : replyTarget.senderContact?.name || contact.name;
      }
    }
  }

  // Keep the source inbox classification current unless the user explicitly
  // promoted this conversation into General.
  if (m.inboxCategory && !conversation.inboxOverride && conversation.inboxCategory !== m.inboxCategory) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { inboxCategory: m.inboxCategory },
    });
  }

  const existing = await prisma.message.findUnique({
    where: { externalKey: m.messageExternalId },
  });
  if (existing) {
    // Browser sends can return before the platform exposes the final native
    // id. When the real echo arrives, collapse that exact short-lived pair
    // while preserving the optimistic row already rendered by the UI.
    if (
      (m.platform === "x" || m.platform === "whatsapp") &&
      m.direction === "out"
    ) {
      const provisionalKeyConditions =
        m.platform === "x"
          ? [{ externalKey: { startsWith: `x:${m.chatExternalId}:` } }]
          : [
              { externalKey: `whatsapp:${m.chatExternalId}:undefined` },
              {
                externalKey: {
                  startsWith: `whatsapp:${m.chatExternalId}:pending:`,
                },
              },
            ];
      const optimisticCandidates = await prisma.message.findMany({
        where: {
          id: { startsWith: "client_", not: existing.id },
          conversationId: conversation.id,
          direction: "out",
          ...(m.platform === "x" ? {} : { body: m.body }),
          mediaType: m.media?.type ?? null,
          OR: provisionalKeyConditions,
          createdAt: {
            gte: new Date((m.timestampVerified ? m.timestamp : existing.createdAt).getTime() - (m.platform === "x" ? 60_000 : 30_000)),
            lte: new Date((m.timestampVerified ? m.timestamp : existing.createdAt).getTime() + (m.platform === "x" ? 60_000 : 30_000)),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      const optimistic = optimisticCandidates.find(candidate => m.platform !== "x" || normalizeXMessageText(candidate.body) === normalizeXMessageText(m.body));
      if (optimistic) {
        await prisma.$transaction([
          prisma.message.delete({ where: { id: existing.id } }),
          prisma.message.update({
            where: { id: optimistic.id },
            data: {
              externalKey: m.messageExternalId,
              deliveryStatus: "sent",
              deliveryError: null,
              createdAt: existing.createdAt,
              senderContactId: existing.senderContactId ?? optimistic.senderContactId,
              ...(m.media
                ? {
                    mediaType: m.media.type,
                    mediaUrl: m.media.url ?? undefined,
                    mediaName: m.media.name,
                    mediaIsGif: m.media.isGif || undefined,
                  }
                : {}),
            },
          }),
        ]);
        return null;
      }
    }
    // Enrich a previously-synced row (media support, or group-sender backfill).
    const patch: Record<string, unknown> = {};
    if (m.platform === "x" && !m.messageExternalId.startsWith("x:preview:")) {
      const body = richerXMessageText(existing.body, m.body);
      if (body !== existing.body) {
        patch.body = body;
        patch.translatedBody = null;
        patch.translationSourceLanguage = null;
        patch.translationTargetLanguage = null;
      }
    }
    if (m.platform === "discord" && m.sourceEdited) {
      patch.body = m.body;
      patch.translatedBody = null;
      patch.translationSourceLanguage = null;
      patch.translationTargetLanguage = null;
    }
    if (m.media?.isGif && !existing.mediaIsGif) patch.mediaIsGif = true;
    if (m.platform === "x" && m.timestampVerified && !existing.id.startsWith("client_")) {
      patch.createdAt = m.timestamp;
    }
    if (m.direction === "out" && existing.deliveryStatus !== "sent") {
      patch.deliveryStatus = "sent";
      patch.deliveryError = null;
    }
    if (m.media && !existing.mediaType) {
      patch.body = m.platform === "x" ? richerXMessageText(existing.body, m.body) : m.body;
      patch.mediaType = m.media.type;
      patch.mediaUrl = m.media.url;
      patch.mediaName = m.media.name;
    } else if (
      m.media?.url &&
      existing.mediaType &&
      existing.mediaUrl !== m.media.url
    ) {
      // The row was stored before the file could be fetched (size cap at the
      // time, a failed download, or a format we've since learned to handle —
      // animated stickers). Replace stale paths as well as filling missing
      // ones so an explicit recovery can repair an already-broken attachment.
      patch.mediaUrl = m.media.url;
      if (m.media.name && !existing.mediaName) patch.mediaName = m.media.name;
      if (m.body && !existing.body) patch.body = m.body;
      // A repaired/re-downloaded image may differ from the file previously
      // indexed. Queue it for fresh local OCR instead of keeping stale text.
      if (m.media.type === "image") {
        patch.ocrText = null;
        patch.ocrStatus = null;
        patch.ocrModel = null;
        patch.ocrError = null;
        patch.ocrUpdatedAt = null;
      }
    }
    // Exact native-message dedupe used to leave unsupported service rows
    // untouched forever. Repair only the old placeholder, never real content.
    if (telegramPlaceholderRepair(m.platform, existing.body, m.body)) {
      patch.body = m.body;
      patch.translatedBody = null;
      patch.translationSourceLanguage = null;
      patch.translationTargetLanguage = null;
    }
    if (senderContactId && !existing.senderContactId)
      patch.senderContactId = senderContactId;
    if (m.replyToExternalKey && !existing.replyToExternalKey)
      patch.replyToExternalKey = m.replyToExternalKey;
    if (replyPreview && !existing.replyPreview)
      patch.replyPreview = replyPreview;
    if (
      replySender &&
      (!existing.replySender || /^\+?\d{7,}$/.test(existing.replySender))
    )
      patch.replySender = replySender;
    if (Object.keys(patch).length)
      await prisma.message.update({ where: { id: existing.id }, data: patch });
    return null;
  }

  if (m.platform === "x") {
    const isPreviewMessage = m.messageExternalId.startsWith("x:preview:");
    if (isPreviewMessage) {
      // The browser inbox preview is the low-traffic live source for X. If the
      // same final message already arrived with its native UUID, do not create
      // a second copy just because this worker restarted and rebuilt its
      // in-memory preview cache.
      const latest = await prisma.message.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, externalKey: true, deliveryStatus: true, direction: true, body: true, createdAt: true, mediaType: true },
      });
      if (
        latest?.direction === m.direction &&
        (xPreviewMatchesText(m.body, latest.body) || Boolean(latest.mediaType && X_MEDIA_PREVIEWS[latest.mediaType]?.includes(m.body.trim()))) &&
        // Generic attachment labels cannot identify two different photos.
        ((!latest.mediaType && !Object.values(X_MEDIA_PREVIEWS).some(labels => labels.includes(m.body.trim()))) ||
          m.timestampVerified === false || Math.abs(latest.createdAt.getTime() - m.timestamp.getTime()) <= 130_000)
      ) {
        // An inbox row is a snapshot, NOT a new message event. Even an absolute
        // clock can change when X re-renders the same request. Only a native
        // message ID proves an identical repeat; history still saves those IDs
        // separately. Do not mint another bubble from a changed clock alone.
        // A matching native inbox echo is also a send receipt. Previously we
        // discarded it as a duplicate, leaving the provisional key in place
        // for the watchdog to incorrectly downgrade 90 seconds later. Require
        // exact text and a nearby platform timestamp; generic attachment
        // previews or old repeated text cannot prove which send succeeded.
        if (
          m.direction === "out" && latest.id.startsWith("client_") &&
          latest.externalKey?.startsWith(`x:${m.chatExternalId}:pending:`) &&
          normalizeXMessageText(latest.body) === normalizeXMessageText(m.body) && !latest.mediaType &&
          m.timestampVerified &&
          Math.abs(latest.createdAt.getTime() - m.timestamp.getTime()) <= 60_000
        ) {
          await prisma.message.updateMany({
            where: { id: latest.id, externalKey: latest.externalKey },
            data: { externalKey: m.messageExternalId, deliveryStatus: "sent", deliveryError: null },
          });
        }
        return null;
      }
    } else {
      // An explicit history fetch can later expose the native UUID for a row
      // first learned from the inbox preview. Upgrade that row in place so the
      // richer backfill never duplicates what the user already saw live.
      const candidates = await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          direction: m.direction,
          externalKey: { startsWith: "x:preview:" },
          createdAt: { gte: new Date(m.timestamp.getTime() - 130000), lte: new Date(m.timestamp.getTime() + 130000) },
        },
        orderBy: { createdAt: "desc" },
      });
      const matches = candidates.filter(candidate => xPreviewMatchesText(candidate.body, m.body) || Boolean(m.media && X_MEDIA_PREVIEWS[m.media.type]?.includes(candidate.body.trim())));
      // Never silently combine repeated/ambiguous previews. Native IDs remain
      // distinct; only one unambiguous nearby preview is promoted in place.
      const preview = matches.length === 1 ? matches[0] : undefined;
      if (preview) {
        await prisma.message.update({
          where: { id: preview.id },
          data: {
            externalKey: m.messageExternalId,
            body: m.body,
            createdAt: m.timestamp,
            senderContactId: senderContactId ?? preview.senderContactId,
            ...(m.media ? { body: m.body, mediaType: m.media.type, mediaUrl: m.media.url, mediaName: m.media.name, mediaIsGif: m.media.isGif || undefined } : {}),
          },
        });
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt:
              !m.historical && m.timestamp.getTime() >= conversation.lastMessageAt.getTime()
                ? m.timestamp
                : undefined,
          },
        });
        return null;
      }
    }
  }

  // A platform echo can arrive after the web request timed out but before the
  // connector returned its message id. Reconcile that echo into the durable
  // optimistic row instead of inserting a second copy. Exact body/media plus
  // a short time window is intentionally conservative: a user may genuinely
  // send the same text twice hours apart.
  if (m.direction === "out") {
    const pendingCandidates = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        direction: "out",
        OR: [
          {
            externalKey: null,
            deliveryStatus: { in: ["pending", "unconfirmed"] },
          },
          ...(m.platform === "x"
            ? [
                {
                  id: { startsWith: "client_" },
                  externalKey: { startsWith: `x:${m.chatExternalId}:` },
                  deliveryStatus: { in: ["pending", "unconfirmed", "sent"] },
                },
              ]
            : m.platform === "whatsapp"
              ? [
                  {
                    id: { startsWith: "client_" },
                    OR: [
                      {
                        externalKey: `whatsapp:${m.chatExternalId}:undefined`,
                      },
                      {
                        externalKey: {
                          startsWith: `whatsapp:${m.chatExternalId}:pending:`,
                        },
                      },
                    ],
                    deliveryStatus: {
                      in: ["pending", "unconfirmed", "sent"],
                    },
                  },
                ]
              : []),
        ],
        ...(m.platform === "x" ? {} : { body: m.body }),
        mediaType: m.media?.type ?? null,
        // Match only nearby sends, in both directions. Old repeated text must
        // never confirm a new pending send merely because it has the same body.
        createdAt: {
          gte: new Date(m.timestamp.getTime() - 5 * 60 * 1000),
          lte: new Date(m.timestamp.getTime() + 5 * 60 * 1000),
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const pending = pendingCandidates.find(candidate => m.platform !== "x" || normalizeXMessageText(candidate.body) === normalizeXMessageText(m.body));
    if (pending) {
      await prisma.message.update({
        where: { id: pending.id },
        data: {
          externalKey: m.messageExternalId,
          deliveryStatus: "sent",
          deliveryError: null,
          createdAt: m.timestamp,
          senderContactId,
          ...(m.replyToExternalKey
            ? {
                replyToExternalKey: m.replyToExternalKey,
                replyPreview,
                replySender,
              }
            : {}),
          ...(m.media
            ? {
                mediaType: m.media.type,
                mediaUrl: m.media.url ?? undefined,
                mediaName: m.media.name,
                mediaIsGif: m.media.isGif || undefined,
              }
            : {}),
        },
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: m.timestamp > conversation.lastMessageAt ? m.timestamp : undefined },
      });
      return null;
    }
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      body: m.body,
      direction: m.direction,
      senderContactId,
      mediaType: m.media?.type,
      mediaUrl: m.media?.url ?? undefined,
      mediaName: m.media?.name,
      mediaIsGif: m.media?.isGif ?? false,
      externalKey: m.messageExternalId,
      replyToExternalKey: m.replyToExternalKey,
      replyPreview,
      replySender,
      deliveryStatus: m.direction === "out" ? "sent" : undefined,
      createdAt: m.timestamp,
    },
  });

  const advancesConversation = !(m.platform === "x" && m.historical) &&
    m.timestamp.getTime() >= conversation.lastMessageAt.getTime();
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: advancesConversation ? m.timestamp : undefined,
      unread: m.direction === "in" && !m.historical ? { increment: 1 } : undefined,
      hasUnreadMention:
        m.direction === "in" && !m.historical && m.mentionsMe ? true : undefined,
      // A new inbound message re-surfaces normal chats. Chats the user archived
      // and muted stay out of the active feed until they explicitly restore
      // them; their unread count still records that something arrived.
      ...(m.direction === "in" && !m.historical && !conversation.archived
        ? { status: "open", snoozedUntil: null, followUpAt: null }
        : {}),
    },
  });
  return m.direction === "in" && !m.historical ? conversation.id : null;
}

/**
 * Persist an emoji reaction.
 *
 * Reactions are only meaningful against a message we already store, so one
 * arriving for an unsynced message is dropped rather than queued — the sync
 * backfill will pick up the message's current reactions when it imports it.
 */
async function persistReactionNow(r: InboundReaction): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { externalKey: r.messageExternalId },
    select: { id: true },
  });
  if (!message) return;

  const actorKey = r.actor.externalKey;

  // Count-only platforms: replace the whole aggregate set for this message.
  if (r.counts) {
    await prisma.reaction.deleteMany({
      where: { messageId: message.id, actorKey: "aggregate" },
    });
    const rows = r.counts.filter((c) => c.emoji && c.count > 0);
    if (rows.length) {
      await prisma.reaction.createMany({
        data: rows.map((c) => ({
          messageId: message.id,
          emoji: c.emoji,
          actorKey: "aggregate",
          count: c.count,
        })),
      });
    }
    return;
  }

  // Platforms that send the actor's whole current set: replace it wholesale so
  // a removal (empty set) and a swap (👍 → 🎉) both land correctly.
  if (r.emojis) {
    await prisma.reaction.deleteMany({ where: { messageId: message.id, actorKey } });
    if (r.emojis.length) {
      await prisma.reaction.createMany({
        data: r.emojis.map((emoji) => ({
          messageId: message.id,
          emoji,
          actorKey,
          actorName: r.actor.name ?? null,
        })),
      });
    }
    return;
  }

  if (!r.emoji) return;

  if (r.removed) {
    await prisma.reaction.deleteMany({
      where: { messageId: message.id, actorKey, emoji: r.emoji },
    });
    return;
  }

  await prisma.reaction.upsert({
    where: {
      messageId_actorKey_emoji: { messageId: message.id, actorKey, emoji: r.emoji },
    },
    create: {
      messageId: message.id,
      emoji: r.emoji,
      actorKey,
      actorName: r.actor.name ?? null,
    },
    update: { actorName: r.actor.name ?? null },
  });
}

export function persistRead(
  accountId: string,
  chatExternalId: string
): Promise<void> {
  return serializeWrite(() => persistReadNow(accountId, chatExternalId));
}

export function persistInbound(m: InboundMessage): Promise<string | null> {
  return serializeWrite(() => persistInboundNow(m));
}

// Metadata-only repair: no new chats, messages, unread changes or automations.
// Scope candidates to this account and preserve non-placeholder/custom names.
export function repairWhatsAppIdentities(accountId: string, identities: WhatsAppIdentity[]): Promise<void> {
  return serializeWrite(async () => {
    const names = new Map(identities.filter(i => i.externalKey.startsWith("whatsapp:") && !isPlaceholderIdentity(i.name)).map(i => [i.externalKey, i]));
    const contacts = await prisma.contact.findMany({
      where: { externalKey: { in: [...names.keys()] }, OR: [
        { conversations: { some: { accountId } } },
        { sentMessages: { some: { conversation: { accountId } } } },
      ] }, select: { id: true, externalKey: true, name: true, handle: true },
    });
    let repaired = 0;
    for (const contact of contacts) {
      const identity = names.get(contact.externalKey!);
      if (!identity || !isPlaceholderIdentity(contact.name)) continue;
      await prisma.contact.update({ where: { id: contact.id }, data: {
        name: identity.name,
        ...(identity.handle && isPlaceholderIdentity(contact.handle) ? { handle: identity.handle } : {}),
      } });
      repaired++;
    }
    if (repaired) console.log(`[whatsapp] repaired ${repaired} saved group/member names`);
  });
}

export function persistReaction(r: InboundReaction): Promise<void> {
  return serializeWrite(() => persistReactionNow(r));
}

// The native inbox is authoritative about the latest activity, even when it
// moves backwards after correcting old import-time placeholders. Preserve
// newer local sends, which a lagging X inbox may not yet reflect.
export function reconcileXConversationTime(accountId: string, externalId: string, timestamp: number): Promise<void> {
  return serializeWrite(async () => {
    const conversation = await prisma.conversation.findFirst({ where: { platform: "x", accountId, externalId } });
    if (!conversation || !Number.isFinite(timestamp)) return;
    const sent = await prisma.message.findFirst({
      where: { conversationId: conversation.id, id: { startsWith: "client_" }, direction: "out", deliveryStatus: { in: ["sent", "pending", "sending", "unconfirmed"] } },
      orderBy: { createdAt: "desc" }, select: { createdAt: true },
    });
    const latest = new Date(Math.max(timestamp, sent?.createdAt.getTime() || 0));
    if (latest.getTime() !== conversation.lastMessageAt.getTime()) {
      await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: latest } });
    }
  });
}
