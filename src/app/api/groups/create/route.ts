import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_GROUP_PLATFORMS = new Set(["telegram", "whatsapp", "gmail"]);

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
  if (!SUPPORTED_GROUP_PLATFORMS.has(platform)) {
    const detail = platform === "discord"
      ? "Discord bots cannot create private group DMs. Create a server channel in Discord instead."
      : "X does not allow this connection to create group DMs safely.";
    return NextResponse.json({ error: detail }, { status: 400 });
  }
  if (platform === "gmail" && !message?.trim()) {
    return NextResponse.json(
      { error: "Add a first message to start the group email." },
      { status: 400 }
    );
  }

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, externalKey: { startsWith: `${platform}:` } },
    select: { id: true, name: true, externalKey: true, handle: true },
  });
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const selectedContacts = contactIds
    .map((contactId) => contactById.get(contactId))
    .filter((contact): contact is (typeof contacts)[number] => !!contact);
  const participantKeys = selectedContacts
    .map((c) => platform === "gmail" ? c.handle : c.externalKey)
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
  const keyForContact = (contact: (typeof contacts)[number]) =>
    String(platform === "gmail" ? contact.handle || "" : contact.externalKey)
      .trim()
      .toLowerCase();
  const contactByParticipantKey = new Map(
    selectedContacts.map((contact) => [keyForContact(contact), contact])
  );
  const nativeOutcomes = Array.isArray(data.participantOutcomes)
    ? data.participantOutcomes
    : participantKeys.map((participantKey) => ({
        participantKey,
        status: "added",
      }));
  const participantOutcomes = nativeOutcomes.map(
    (outcome: {
      participantKey?: string;
      status?: "added" | "invite_sent" | "not_added";
      detail?: string;
    }) => {
      const participantKey = String(outcome.participantKey || "");
      const contact = contactByParticipantKey.get(
        participantKey.trim().toLowerCase()
      );
      return {
        contactId: contact?.id || null,
        name: contact?.name || "Platform contact",
        participantKey,
        status: outcome.status || "not_added",
        detail: outcome.detail,
      };
    }
  );

  return NextResponse.json({
    ok: true,
    chatExternalId: data.chatExternalId,
    inviteUrl: data.inviteUrl,
    participantOutcomes,
  });
}
