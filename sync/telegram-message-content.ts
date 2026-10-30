// Telegram service messages carry an action instead of text/media:
// https://core.telegram.org/constructor/messageService
// Keep a readable, searchable summary without inventing missing message text.
type Native = { [key: string]: any };
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const richText = (value: unknown): string => text(value) || text((value as Native | null)?.text);
const kind = (value: Native | null | undefined): string => value?.className || "";
const memberName = (entity: Native | undefined): string =>
  [text(entity?.firstName), text(entity?.lastName)].filter(Boolean).join(" ") || text(entity?.username);

export function telegramSpecialBody(message: Native, actorName?: string, names?: ReadonlyMap<string, string>): string {
  const actorId = String(message.senderId ?? message.fromId?.userId ?? message.fromId?.channelId ?? "");
  const actor = message.out ? "You" : text(actorName) || memberName(message.sender) || "A member";
  const name = (id: unknown) => names?.get(String(id)) || memberName(message._entities?.get?.(String(id)));
  const action = message.action;
  if (action) {
    switch (kind(action)) {
      case "MessageActionChatCreate": return `${actor} created the group${text(action.title) ? ` “${text(action.title)}”` : ""}.`;
      case "MessageActionChannelCreate": return `Channel created${text(action.title) ? `: ${text(action.title)}` : ""}.`;
      case "MessageActionChatAddUser": {
        const users: unknown[] = Array.isArray(action.users) ? action.users : [];
        if (users.length === 1 && String(users[0]) === actorId) return `${actor} joined the group.`;
        const labels = users.map(name);
        const added = users.length && labels.every(Boolean) ? labels.join(", ") : users.length ? `${users.length} member${users.length === 1 ? "" : "s"}` : "members";
        return `${actor} added ${added} to the group.`;
      }
      case "MessageActionChatDeleteUser": return String(action.userId) === actorId ? `${actor} left the group.` : `${actor} removed ${name(action.userId) || "a member"} from the group.`;
      case "MessageActionChatJoinedByLink": return `${actor} joined via an invite link.`;
      case "MessageActionChatJoinedByRequest": return `${actor} joined after their request was approved.`;
      case "MessageActionChatEditTitle": return `${actor} renamed the group${text(action.title) ? ` to “${text(action.title)}”` : ""}.`;
      case "MessageActionChatEditPhoto": return `${actor} changed the group photo.`;
      case "MessageActionChatDeletePhoto": return `${actor} removed the group photo.`;
      case "MessageActionPinMessage": return `${actor} pinned a message.`;
      case "MessageActionHistoryClear": return "Chat history was cleared in Telegram.";
      case "MessageActionChatMigrateTo": case "MessageActionChannelMigrateFrom": return "This group was upgraded to a supergroup.";
      case "MessageActionContactSignUp": return `${actor} joined Telegram.`;
      case "MessageActionScreenshotTaken": return `${actor} took a screenshot.`;
      case "MessageActionPhoneCall": {
        const reason = kind(action.reason);
        const state = reason === "PhoneCallDiscardReasonMissed" ? "Missed" : reason === "PhoneCallDiscardReasonBusy" ? "Declined" : message.out ? "Outgoing" : "Incoming";
        const seconds = Number(action.duration);
        return `${state} ${action.video ? "video" : "voice"} call${Number.isFinite(seconds) && seconds > 0 ? ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : ""}.`;
      }
      case "MessageActionGroupCall": return action.duration == null ? "Group call started." : "Group call ended.";
      case "MessageActionGroupCallScheduled": return "A group call was scheduled in Telegram.";
      case "MessageActionInviteToGroupCall": return `${actor} invited members to a group call.`;
      case "MessageActionSetMessagesTTL": return Number(action.period) > 0 ? `${actor} set auto-delete to ${Number(action.period)} seconds.` : `${actor} turned off auto-delete.`;
      case "MessageActionSetChatTheme": return `${actor} ${text(action.emoticon) ? `changed the chat theme to ${text(action.emoticon)}` : "reset the chat theme"}.`;
      case "MessageActionSetChatWallPaper": return `${actor} changed the chat wallpaper.`;
      case "MessageActionTopicCreate": return `${actor} created a topic${text(action.title) ? `: ${text(action.title)}` : ""}.`;
      case "MessageActionTopicEdit": return `${actor} updated the topic${text(action.title) ? `: ${text(action.title)}` : ""}.`;
      case "MessageActionCustomAction": return text(action.message) || "Telegram service update.";
      default: return "Telegram service update. Open Telegram for details.";
    }
  }
  const media = message.media;
  switch (kind(media)) {
    case "MessageMediaContact": return ["Shared contact", [text(media.firstName), text(media.lastName)].filter(Boolean).join(" "), text(media.phoneNumber)].filter(Boolean).join("\n");
    case "MessageMediaPoll": return [media.poll?.quiz ? "Quiz" : "Poll", richText(media.poll?.question), ...(media.poll?.answers || []).map((answer: Native) => richText(answer.text)).filter(Boolean).map((answer: string) => `• ${answer}`), "Open Telegram to vote or see the latest results."].filter(Boolean).join("\n");
    case "MessageMediaGeo": case "MessageMediaGeoLive": case "MessageMediaVenue": {
      const lat = media.geo?.lat, long = media.geo?.long;
      const valid = typeof lat === "number" && typeof long === "number" && Number.isFinite(lat) && Number.isFinite(long) && Math.abs(lat) <= 90 && Math.abs(long) <= 180;
      return [kind(media) === "MessageMediaGeoLive" ? "Shared live location (snapshot)" : "Shared location", text(media.title), text(media.address), valid ? `https://maps.google.com/?q=${lat},${long}` : "Location unavailable"].filter(Boolean).join("\n");
    }
    case "MessageMediaDice": return `${text(media.emoticon) || "Dice"}${Number(media.value) > 0 ? ` · ${Number(media.value)}` : ""}`;
    case "MessageMediaGame": return ["Shared game", text(media.game?.title), text(media.game?.description), "Open Telegram to play."].filter(Boolean).join("\n");
    case "MessageMediaInvoice": return ["Invoice", text(media.title), text(media.description), "Open Telegram to view payment details."].filter(Boolean).join("\n");
    case "MessageMediaWebPage": return text(media.webpage?.url) || text(media.webpage?.displayUrl) || "Shared link. Open Telegram to view it.";
    case "MessageMediaStory": return "Shared Telegram story. Open Telegram to view it.";
    case "MessageMediaPhoto": case "MessageMediaDocument": return media.ttlSeconds ? "Disappearing media is unavailable here. View it in Telegram if it has not expired." : "Telegram attachment is unavailable. Open Telegram to check it.";
    default: return "Telegram message type is not available here. Open Telegram to view it.";
  }
}

export function telegramPlaceholderRepair(platform: string, oldBody: string, newBody: string): boolean {
  return platform === "telegram" && oldBody.trim() === "[unsupported message]" && !!newBody.trim() && newBody.trim() !== "[unsupported message]";
}
