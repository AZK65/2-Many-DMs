import { NextRequest, NextResponse } from "next/server";
import { matchConversations, renderTemplate } from "@/lib/automations";
import type { AutomationMatchDTO } from "@/lib/types";
import type { Platform } from "@/lib/platforms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dry-run: given a draft automation config, return exactly which chats it would
// target right now (and the message each would receive). Sends nothing.
export async function POST(req: NextRequest) {
  const cfg = await req.json();
  const convs = await matchConversations(cfg);
  const matches: AutomationMatchDTO[] = convs.slice(0, 100).map((c) => ({
    conversationId: c.id,
    name: c.contact.name,
    handle: c.contact.handle,
    avatarUrl: c.contact.avatarUrl,
    platform: c.platform as Platform,
    lastMessage: c.messages[0]?.body || null,
    preview: renderTemplate(String(cfg.message || ""), c.contact.name),
  }));
  return NextResponse.json({ total: convs.length, matches });
}
