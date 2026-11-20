import { jidNormalizedUser } from "@whiskeysockets/baileys";
import type { MemberResult } from "../src/lib/group-membership";

type Outcome = Pick<MemberResult, "status" | "detail">;
const unknown = (): Outcome => ({ status: "unknown", detail: "Could not confirm membership. Check the group in the native app before trying again." });
const already = (): Outcome => ({ status: "already_member", detail: "Already in this group." });
const added = (): Outcome => ({ status: "added", detail: "Added to the group." });

export function membershipError(error: unknown): Outcome {
  const code = String((error as { errorMessage?: string })?.errorMessage || (error as Error)?.message || error);
  if (/USER_ALREADY_PARTICIPANT/.test(code)) return already();
  if (/CHAT_ADMIN_REQUIRED|CHAT_WRITE_FORBIDDEN|USER_NOT_PARTICIPANT/.test(code)) return { status: "not_added", detail: "Your account does not have permission to add people to this group." };
  if (/USER_PRIVACY_RESTRICTED|USER_NOT_MUTUAL_CONTACT|USER_IS_BLOCKED|USER_BLOCKED/.test(code)) return { status: "not_added", detail: "Their privacy or contact settings prevent this addition. No private invitation was sent." };
  if (/USERS_TOO_MUCH|USER_CHANNELS_TOO_MUCH/.test(code)) return { status: "not_added", detail: "A group or account membership limit was reached." };
  if (/FLOOD_WAIT|PEER_FLOOD/.test(code)) return { status: "not_added", detail: "Telegram asked you to wait. Try later in Telegram; this action will not retry automatically." };
  if (/USER_ID_INVALID|INPUT_USER_DEACTIVATED|USERNAME_NOT_OCCUPIED/.test(code)) return { status: "not_added", detail: "This person is no longer available to add." };
  return unknown();
}

function whatsappOutcome(code: unknown): Outcome {
  if (String(code) === "200") return added();
  if (String(code) === "409") return already();
  const details: Record<string, string> = {
    "403": "Privacy settings or group permissions prevented this addition. No private invitation was sent.",
    "404": "This phone number is not registered on WhatsApp.",
    "408": "This person recently left the group and cannot be added yet.",
    "417": "This community requires an invitation through WhatsApp.",
    "419": "This group is full.",
  };
  return details[String(code)] ? { status: "not_added", detail: details[String(code)] } : unknown();
}

// These helpers accept transport objects so native results can be tested without
// connecting accounts or inviting real people. Never send a fallback invite DM.
export async function addBaileysGroupMember(sock: any, groupId: string, key: string): Promise<Outcome> {
  if (!/^\d[\d-]*@g\.us$/.test(groupId)) throw new Error("Choose a WhatsApp group.");
  let person = jidNormalizedUser(key.replace(/^whatsapp:/, ""));
  if (!/^\d+@(s\.whatsapp\.net|lid)$/.test(person)) throw new Error("Choose a valid WhatsApp contact.");
  const metadata = await sock.groupMetadata(groupId);
  const has = (id: string) => metadata.participants.some((p: any) => [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean).some(v => jidNormalizedUser(v) === id));
  if (has(person)) return already();
  if (person.endsWith("@lid")) {
    const phone = await sock.signalRepository?.lidMapping?.getPNForLID(person);
    if (!phone) return { status: "not_added", detail: "WhatsApp has hidden this number. Enter their full phone number manually." };
    person = jidNormalizedUser(phone);
    if (has(person)) return already();
  }
  if (!/^\d+@s\.whatsapp\.net$/.test(person)) throw new Error("WhatsApp could not verify this phone number.");
  const rows = await sock.groupParticipantsUpdate(groupId, [person], "add");
  const row = rows.find((r: any) => r.jid && jidNormalizedUser(r.jid) === person);
  // A success must refer to the exact requested identity, never another result.
  return whatsappOutcome(row?.status);
}

export async function addWebGroupMember(client: any, groupId: string, key: string): Promise<Outcome> {
  if (!/^\d[\d-]*@g\.us$/.test(groupId)) throw new Error("Choose a WhatsApp group.");
  const person = key.replace(/^whatsapp:/, "").replace(/@s\.whatsapp\.net$/, "@c.us");
  if (!/^\d+@(c\.us|lid)$/.test(person)) throw new Error("Choose a valid WhatsApp contact.");
  const chat = await client.getChatById(groupId);
  if (!chat.isGroup || typeof chat.addParticipants !== "function") throw new Error("Choose a WhatsApp group.");
  const result = await chat.addParticipants([person], { autoSendInviteV4: false });
  if (typeof result === "string") return { status: "not_added", detail: "WhatsApp could not add this person. Check your group admin permissions." };
  return whatsappOutcome(result?.[person]?.code);
}

export async function addTelegramGroupMember(client: any, Api: any, peer: any, key: string): Promise<Outcome> {
  if (!/^telegram:\d+$/.test(key)) throw new Error("Choose a verified Telegram person.");
  const group = await client.getEntity(peer);
  if (!(group instanceof Api.Chat) && !(group instanceof Api.Channel && group.megagroup && !group.broadcast)) throw new Error("Choose a Telegram group, not a channel or direct chat.");
  const user = await client.getEntity(Number(key.slice("telegram:".length)));
  if (!(user instanceof Api.User) || user.deleted) throw new Error("This Telegram person could not be found.");
  // The adapter supplies its own TL constructors. This works with both the
  // original GramJS connection and newer protocol drivers without mixing them.
  const isMember = async () => {
    if (group instanceof Api.Chat) {
      const full = await client.invoke(new Api.messages.GetFullChat({ chatId: group.id }));
      return full.fullChat?.participants?.participants?.some((p: any) => String(p.userId) === String(user.id)) === true;
    }
    try {
      const result = await client.invoke(new Api.channels.GetParticipant({ channel: group, participant: user }));
      return !!result.participant && !/Left|Banned/.test(result.participant.className || "");
    } catch (error) {
      if (!/USER_NOT_PARTICIPANT/.test(String((error as any)?.errorMessage || error))) throw error;
      return false;
    }
  };
  if (await isMember()) return already();
  try {
    const result = await client.invoke(group instanceof Api.Chat
      ? new Api.messages.AddChatUser({ chatId: group.id, userId: user, fwdLimit: 0 })
      : new Api.channels.InviteToChannel({ channel: group, users: [user] }));
    if (result.missingInvitees?.some((p: any) => String(p.userId) === String(user.id))) return { status: "not_added", detail: "Telegram requires this person to join through an invitation. No private invitation was sent." };
    return await isMember() ? added() : unknown();
  } catch (error) { return membershipError(error); }
}
