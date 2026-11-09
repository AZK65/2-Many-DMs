const MEETING_DRAFT_PREFIX = "📅 Meeting details";
const MEETING_CONFIRMED_PREFIX = "✅ Meeting booked";
const LEGACY_CALL_INVITE_PREFIX = "📅 Call invite";
const GOOGLE_CALENDAR_BASE = "https://calendar.google.com/calendar/render";

export type MeetingType = "online" | "in_person";

export type CallInvite = {
  title: string;
  startsAt: string;
  endsAt: string;
  calendarUrl: string | null;
  meetingUrl: string | null;
  location: string | null;
  meetingType: MeetingType;
  guests: string[];
  guestTimeZone: string | null;
  calBookingUid: string | null;
};

type BuildCallInviteInput = {
  title: string;
  startsAt: Date;
  durationMinutes: number;
  meetingUrl?: string;
  location?: string;
  meetingType?: MeetingType;
  guests?: string[];
  guestTimeZone?: string;
  calBookingUid?: string;
};

function compactLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeMeetingUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeTimeZone(value: string | undefined): string | null {
  const timeZone = value?.trim();
  if (!timeZone) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return timeZone;
  } catch {
    return null;
  }
}

function receiptTimestamp(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "longOffset",
  }).format(date);
}

export function buildCallInvite({
  title,
  startsAt,
  durationMinutes,
  meetingUrl,
  location,
  meetingType,
  guests = [],
  guestTimeZone,
  calBookingUid,
}: BuildCallInviteInput): string {
  const cleanTitle = compactLine(title) || "Meeting";
  const minutes = Math.max(15, Math.min(240, Math.round(durationMinutes)));
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
  const joinUrl = safeMeetingUrl(meetingUrl);
  const place = compactLine(location || "").slice(0, 300) || null;
  const type: MeetingType = meetingType === "in_person" || place ? "in_person" : "online";
  const attendeeTimeZone = safeTimeZone(guestTimeZone)
    || safeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
    || "UTC";
  const guestEmails = [...new Set(guests.map(email => email.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const booked = Boolean(calBookingUid);

  return [
    booked ? MEETING_CONFIRMED_PREFIX : MEETING_DRAFT_PREFIX,
    cleanTitle,
    `When: ${receiptTimestamp(startsAt, attendeeTimeZone)} → ${receiptTimestamp(endsAt, attendeeTimeZone)}`,
    guestEmails.length ? `${booked ? "Invite sent to" : "Invite"}: ${guestEmails.join(", ")}` : null,
    `Time zone: ${attendeeTimeZone}`,
    type === "in_person" && place ? `Location: ${place}` : null,
    type === "online" && joinUrl ? `Online: ${joinUrl}` : null,
  ].filter(Boolean).join("\n");
}

function parseMeetingReceipt(body: string): CallInvite | null {
  const match = body.match(/(?:^|\n)(📅 Meeting details|✅ Meeting booked)\s*\n([^\n]+)\n([\s\S]*)/);
  if (!match) return null;
  const [, prefix, rawTitle, rest] = match;
  const when = rest.match(/^When:\s*(.+?)\s+→\s+(.+)$/im);
  if (!when) return null;
  const startsAt = new Date(when[1].trim());
  const endsAt = new Date(when[2].trim());
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return null;
  const guestLine = rest.match(/^Invite(?: sent to)?:\s*(.+)$/im)?.[1] || "";
  const guests = [...new Set(guestLine.split(",").map(email => email.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const guestTimeZone = safeTimeZone(compactLine(rest.match(/^Time zone:\s*(.+)$/im)?.[1] || "") || undefined);
  const location = compactLine(rest.match(/^Location:\s*(.+)$/im)?.[1] || "").slice(0, 300) || null;
  const meetingUrl = safeMeetingUrl(compactLine(rest.match(/^Online:\s*(.+)$/im)?.[1] || "") || undefined);
  return {
    title: compactLine(rawTitle) || "Meeting",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    calendarUrl: null,
    meetingUrl,
    location,
    meetingType: location ? "in_person" : "online",
    guests,
    guestTimeZone,
    calBookingUid: prefix === MEETING_CONFIRMED_PREFIX ? "confirmed" : null,
  };
}

function parseCalendarTimestamp(value: string): Date | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
  ));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseLegacyCallInvite(body: string): CallInvite | null {
  if (!body.trimStart().startsWith(LEGACY_CALL_INVITE_PREFIX)) return null;
  const match = body.match(/https:\/\/calendar\.google\.com\/calendar\/render\?[^\s]+/i);
  if (!match) return null;
  try {
    const calendarUrl = new URL(match[0]);
    if (calendarUrl.origin + calendarUrl.pathname !== GOOGLE_CALENDAR_BASE) return null;
    if (calendarUrl.searchParams.get("action") !== "TEMPLATE") return null;
    const [startRaw, endRaw] = (calendarUrl.searchParams.get("dates") || "").split("/");
    const startsAt = parseCalendarTimestamp(startRaw || "");
    const endsAt = parseCalendarTimestamp(endRaw || "");
    if (!startsAt || !endsAt || endsAt <= startsAt) return null;
    const title = compactLine(calendarUrl.searchParams.get("text") || "Call") || "Call";
    const meetingUrl = safeMeetingUrl(calendarUrl.searchParams.get("location") || undefined);
    const guests = [...new Set([
      ...calendarUrl.searchParams.getAll("add"),
      ...(body.match(/^Guests:\s*(.+)$/im)?.[1]?.split(",") || []),
    ].map(email => email.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    const guestTimeZone = safeTimeZone(compactLine(body.match(/^Guest time zone:\s*(.+)$/im)?.[1] || "") || undefined);
    const calBookingUid = compactLine(body.match(/^Cal\.com booking:\s*(.+)$/im)?.[1] || "") || null;
    return {
      title,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      calendarUrl: calendarUrl.toString(),
      meetingUrl,
      location: null,
      meetingType: "online",
      guests,
      guestTimeZone,
      calBookingUid,
    };
  } catch {
    return null;
  }
}

export function parseCallInvite(body: string): CallInvite | null {
  return parseMeetingReceipt(body) || parseLegacyCallInvite(body);
}
