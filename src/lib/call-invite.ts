const CALL_INVITE_PREFIX = "📅 Call invite";
const GOOGLE_CALENDAR_BASE = "https://calendar.google.com/calendar/render";

export type CallInvite = {
  title: string;
  startsAt: string;
  endsAt: string;
  calendarUrl: string;
  meetingUrl: string | null;
  guests: string[];
  guestTimeZone: string | null;
  calBookingUid: string | null;
};

type BuildCallInviteInput = {
  title: string;
  startsAt: Date;
  durationMinutes: number;
  meetingUrl?: string;
  guests?: string[];
  guestTimeZone?: string;
  calBookingUid?: string;
};

function compactLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function calendarTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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

export function buildCallInvite({
  title,
  startsAt,
  durationMinutes,
  meetingUrl,
  guests = [],
  guestTimeZone,
  calBookingUid,
}: BuildCallInviteInput): string {
  const cleanTitle = compactLine(title) || "Call";
  const minutes = Math.max(15, Math.min(240, Math.round(durationMinutes)));
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
  const joinUrl = safeMeetingUrl(meetingUrl);
  const attendeeTimeZone = safeTimeZone(guestTimeZone);
  const guestEmails = [...new Set(guests.map(email => email.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const calendarUrl = new URL(GOOGLE_CALENDAR_BASE);
  calendarUrl.searchParams.set("action", "TEMPLATE");
  calendarUrl.searchParams.set("text", cleanTitle);
  calendarUrl.searchParams.set(
    "dates",
    `${calendarTimestamp(startsAt)}/${calendarTimestamp(endsAt)}`,
  );
  calendarUrl.searchParams.set("details", "Call invite from this conversation.");
  if (joinUrl) calendarUrl.searchParams.set("location", joinUrl);
  for (const email of guestEmails) calendarUrl.searchParams.append("add", email);

  const when = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(startsAt);

  return [
    CALL_INVITE_PREFIX,
    cleanTitle,
    `${when} · ${minutes} min`,
    calendarUrl.toString(),
    joinUrl ? `Join: ${joinUrl}` : null,
    guestEmails.length ? `Guests: ${guestEmails.join(", ")}` : null,
    attendeeTimeZone ? `Guest time zone: ${attendeeTimeZone}` : null,
    calBookingUid ? `Cal.com booking: ${compactLine(calBookingUid)}` : null,
  ].filter(Boolean).join("\n");
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

export function parseCallInvite(body: string): CallInvite | null {
  if (!body.trimStart().startsWith(CALL_INVITE_PREFIX)) return null;
  const match = body.match(/https:\/\/calendar\.google\.com\/calendar\/render\?[^\s]+/i);
  if (!match) return null;
  try {
    const calendarUrl = new URL(match[0]);
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
      guests,
      guestTimeZone,
      calBookingUid,
    };
  } catch {
    return null;
  }
}
