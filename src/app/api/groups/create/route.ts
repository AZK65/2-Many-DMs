import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Create a group on a platform with the chosen contacts as members, then
// (optionally) send a first message. Routes through the sync worker, which owns
// the live connection.
export async function POST(req: NextRequest) {
  const { platform, contactIds, name, message } = (await req
    .json()
    .catch(() => ({}))) as {
    platform?: string;
    contactIds?: string[];
    name?: string;
    message?: string;
  };

  if (!platform || !name?.trim() || !Array.isArray(contactIds) || !contactIds.length) {
    return NextResponse.json(
      { error: "Pick a name and at least one contact." },
      { status: 400 }
    );
  }

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, externalKey: { startsWith: `${platform}:` } },
    select: { externalKey: true },
  });
  const participantKeys = contacts
    .map((c) => c.externalKey)
    .filter((k): k is string => !!k);
  if (!participantKeys.length) {
    return NextResponse.json(
      { error: "Selected contacts aren't on that platform." },
      { status: 400 }
    );
  }

  const account = await prisma.account.findFirst({ where: { platform } });
  const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
  let res: Response;
  try {
    res = await fetch(`${controlUrl}/group/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        accountId: account?.id,
        name: name.trim(),
        participantKeys,
        message: message?.trim() || undefined,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Sync worker unreachable. Is `npm run sync` running?" },
      { status: 502 }
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: data.error || "Couldn't create the group." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, chatExternalId: data.chatExternalId });
}
