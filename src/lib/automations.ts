import { prisma } from "./db";
import { randomUUID } from "node:crypto";
import type { Automation, Prisma } from "@prisma/client";
import type { ActionStep, AutomationDTO, ConversationIntent } from "./types";
import type { Platform } from "./platforms";

// Parse the stored action chain; fall back to a single "send" from the legacy
// `message` field for automations created before the node flow.
export function parseActions(a: Pick<Automation, "actions" | "message">): ActionStep[] {
  if (a.actions) {
    try {
      const arr = JSON.parse(a.actions);
      if (Array.isArray(arr) && arr.length) return arr as ActionStep[];
    } catch {
      /* fall through */
    }
  }
  return [{ id: "send", type: "send", message: a.message || "" }];
}

export function automationToDTO(
  a: Automation,
  matchCount: number
): AutomationDTO {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    trigger: a.trigger as AutomationDTO["trigger"],
    keyword: a.keyword,
    noReplyDays: a.noReplyDays,
    platform: (a.platform as Platform) ?? null,
    tagId: a.tagId,
    folderId: a.folderId,
    intent: (a.intent as ConversationIntent) ?? null,
    message: a.message,
    actions: parseActions(a),
    schedule: a.schedule as AutomationDTO["schedule"],
    everyNDays: a.everyNDays,
    cooldownDays: a.cooldownDays,
    lastRunAt: a.lastRunAt ? a.lastRunAt.toISOString() : null,
    matchCount,
  };
}

// Whitelist + coerce a create/update payload from the API.
export function sanitizeAutomationInput(b: Record<string, unknown>) {
  // Normalize the action chain; the first send's text doubles as `message`.
  const steps = Array.isArray(b.actions)
    ? (b.actions as ActionStep[]).filter(
        (s) =>
          s &&
          (s.type === "send" ||
            s.type === "tag" ||
            s.type === "status" ||
            s.type === "intent" ||
            s.type === "follow_up")
      )
    : [];
  const firstSend = steps.find((s) => s.type === "send") as
    | { message: string }
    | undefined;

  const validTriggers = [
    "keyword",
    "no_reply",
    "unanswered",
    "new_chat",
    "broadcast",
  ];
  const data: Prisma.AutomationUncheckedCreateInput = {
    name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : "Untitled automation",
    trigger:
      typeof b.trigger === "string" && validTriggers.includes(b.trigger)
        ? b.trigger
        : "keyword",
    message:
      firstSend?.message ?? (typeof b.message === "string" ? b.message : ""),
    actions: steps.length ? JSON.stringify(steps) : null,
  };
  if (typeof b.enabled === "boolean") data.enabled = b.enabled;
  data.keyword =
    typeof b.keyword === "string" && b.keyword.trim() ? b.keyword.trim() : null;
  data.noReplyDays =
    typeof b.noReplyDays === "number" ? Math.max(1, Math.round(b.noReplyDays)) : null;
  data.platform =
    b.platform === "x" ||
    b.platform === "whatsapp" ||
    b.platform === "telegram" ||
    b.platform === "discord"
      ? b.platform
      : null;
  data.tagId = typeof b.tagId === "string" && b.tagId ? b.tagId : null;
  data.folderId =
    typeof b.folderId === "string" && b.folderId ? b.folderId : null;
  data.intent =
    b.intent === "normal" ||
    b.intent === "prospect" ||
    b.intent === "onboarding" ||
    b.intent === "support"
      ? b.intent
      : null;
  data.schedule =
    b.schedule === "instant" ||
    b.schedule === "daily" ||
    b.schedule === "every_n_days"
      ? b.schedule
      : "manual";
  data.everyNDays =
    typeof b.everyNDays === "number" ? Math.max(1, Math.round(b.everyNDays)) : null;
  data.cooldownDays =
    typeof b.cooldownDays === "number" ? Math.max(0, Math.round(b.cooldownDays)) : 7;
  return data;
}

export interface MatchConfig {
  trigger: string; // keyword | no_reply | unanswered | new_chat | broadcast
  keyword?: string | null;
  noReplyDays?: number | null;
  platform?: string | null;
  tagId?: string | null;
  folderId?: string | null;
  intent?: string | null;
}

const DAY = 86_400_000;

// Resolve the set of conversations a trigger+filters targets right now.
export async function matchConversations(cfg: MatchConfig) {
  // Base: active chats (not hidden, not done, not currently snoozed).
  const where: Prisma.ConversationWhereInput = {
    hidden: false,
    status: { not: "done" },
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }],
  };
  if (cfg.platform) where.platform = cfg.platform;
  if (cfg.folderId) where.folders = { some: { folderId: cfg.folderId } };
  if (cfg.intent) where.intent = cfg.intent;

  // Contact sub-filter (tag + new-chat recency share this object).
  const contact: Prisma.ContactWhereInput = {};
  if (cfg.tagId) contact.tags = { some: { tagId: cfg.tagId } };

  const days = cfg.noReplyDays ?? 3;
  const cutoff = new Date(Date.now() - days * DAY);

  switch (cfg.trigger) {
    case "keyword": {
      const kw = (cfg.keyword || "").trim();
      if (!kw) return [];
      break;
    }
    case "no_reply": // you sent last, they're quiet
    case "unanswered": // they sent last, you're overdue
      where.lastMessageAt = { lt: cutoff };
      break;
    case "new_chat":
      contact.createdAt = { gt: cutoff };
      break;
    case "broadcast": // everyone matching the filters
      break;
    default:
      return [];
  }

  if (Object.keys(contact).length) where.contact = contact;

  const convs = await prisma.conversation.findMany({
    where,
    include: {
      contact: true,
      messages: { orderBy: { createdAt: "desc" }, take: 10 },
    },
    orderBy: { lastMessageAt: "asc" },
    take: 500,
  });

  // Direction-sensitive triggers: who sent the last message?
  if (cfg.trigger === "no_reply") {
    return convs.filter((c) => c.messages[0]?.direction === "out");
  }
  if (cfg.trigger === "unanswered") {
    return convs.filter((c) => c.messages[0]?.direction === "in");
  }
  if (cfg.trigger === "keyword") {
    const terms = (cfg.keyword || "")
      .split(/[,|]/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    return convs.filter((c) => {
      const latestInbound = c.messages.find((m) => m.direction === "in");
      const body = latestInbound?.body.toLowerCase() || "";
      return terms.some((term) => body.includes(term));
    });
  }
  return convs;
}

// {name} → full name, {first} → first name. Case-insensitive.
export function renderTemplate(tmpl: string, name: string): string {
  const first = name.split(" ").filter(Boolean)[0] || name;
  return tmpl.replace(/\{first\}/gi, first).replace(/\{name\}/gi, name);
}

type ConvForSend = {
  id: string;
  platform: string;
  externalId: string | null;
  accountId: string | null;
};

class DeliveryUnconfirmedError extends Error {}

// Send one message, reusing the sync worker's /send path, and record it locally.
async function sendOutbound(conv: ConvForSend, text: string): Promise<void> {
  if (conv.platform === "discord") {
    throw new Error(
      "Discord bot messages are manual-only; automation sends are disabled for this connector."
    );
  }
  const pendingMessageId = `automation_${randomUUID()}`;
  let createdAt = new Date();
  let message = await prisma.message.create({
    data: {
      id: pendingMessageId,
      conversationId: conv.id,
      body: text,
      direction: "out",
      createdAt,
      deliveryStatus: conv.externalId ? "pending" : "sent",
      sendAttempts: conv.externalId ? 1 : 0,
      lastSendAttemptAt: conv.externalId ? createdAt : null,
    },
  });

  if (conv.externalId) {
    const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
    const res = await fetch(`${controlUrl}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: conv.platform,
        accountId: conv.accountId,
        chatExternalId: conv.externalId,
        text,
        pendingMessageId,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as {
        error?: string;
        uncertain?: boolean;
        accepted?: boolean;
      };
      if (d.uncertain || res.status === 504) {
        await prisma.message.updateMany({
          where: { id: pendingMessageId, deliveryStatus: "pending" },
          data: {
            deliveryStatus: "unconfirmed",
            deliveryError:
              "The platform did not confirm delivery. Check the native app before retrying.",
          },
        });
        throw new DeliveryUnconfirmedError(
          "Delivery is unconfirmed; the automation will not retry automatically."
        );
      }
      await prisma.message.update({
        where: { id: pendingMessageId },
        data: {
          deliveryStatus: "failed",
          deliveryError: d.error || `Send failed (${res.status})`,
        },
      });
      throw new Error(d.error || `send failed (${res.status})`);
    }
    const sent = await res.json() as { messageExternalId: string; timestamp: string };
    createdAt = new Date(sent.timestamp);
    message = await prisma.message.update({
      where: { id: pendingMessageId },
      data: {
        externalKey: sent.messageExternalId,
        createdAt,
        deliveryStatus: "sent",
        deliveryError: null,
      },
    });
  }
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: message.createdAt, status: "open", snoozedUntil: null },
  });
}

export async function sendConversationAutomationMessage(
  conversationId: string,
  text: string,
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      platform: true,
      externalId: true,
      accountId: true,
    },
  });
  if (!conversation) throw new Error("The linked chat could not be found.");
  if (!conversation.externalId) throw new Error("The linked chat is not connected to a platform.");
  await sendOutbound(conversation, text);
}

// Run an automation now: message every matched chat that isn't on cooldown.
export async function runAutomation(id: string, onlyConversationId?: string) {
  const a = await prisma.automation.findUnique({ where: { id } });
  if (!a) throw new Error("Automation not found");

  const matched = await matchConversations(a);
  const convs = onlyConversationId
    ? matched.filter((c) => c.id === onlyConversationId)
    : matched;
  const actions = parseActions(a);
  const cutoff = new Date(Date.now() - a.cooldownDays * DAY);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of convs) {
    const recent = await prisma.automationRun.findFirst({
      where: {
        automationId: a.id,
        conversationId: c.id,
        status: { in: ["sent", "skipped"] },
        createdAt: { gt: cutoff },
      },
    });
    if (recent) {
      skipped++;
      continue;
    }
    try {
      // Run each node in the chain for this chat, in order.
      for (const step of actions) {
        if (step.type === "send") {
          await sendOutbound(c, renderTemplate(step.message, c.contact.name));
        } else if (step.type === "tag" && step.tagId) {
          await prisma.contactTag.upsert({
            where: {
              contactId_tagId: { contactId: c.contactId, tagId: step.tagId },
            },
            create: { contactId: c.contactId, tagId: step.tagId },
            update: {},
          });
        } else if (step.type === "status") {
          await prisma.conversation.update({
            where: { id: c.id },
            data: { status: step.status },
          });
        } else if (step.type === "intent") {
          await prisma.conversation.update({
            where: { id: c.id },
            data: { intent: step.intent },
          });
        } else if (step.type === "follow_up") {
          await prisma.conversation.update({
            where: { id: c.id },
            data: {
              followUpAt: new Date(Date.now() + Math.max(0, step.days) * DAY),
            },
          });
        }
      }
      await prisma.automationRun.create({
        data: { automationId: a.id, conversationId: c.id, status: "sent" },
      });
      sent++;
    } catch (e) {
      await prisma.automationRun.create({
        data: {
          automationId: a.id,
          conversationId: c.id,
          status: e instanceof DeliveryUnconfirmedError ? "skipped" : "failed",
          detail: String((e as Error).message || e).slice(0, 200),
        },
      });
      if (e instanceof DeliveryUnconfirmedError) skipped++;
      else failed++;
    }
  }

  await prisma.automation.update({
    where: { id },
    data: { lastRunAt: new Date() },
  });
  return { matched: convs.length, sent, skipped, failed };
}
