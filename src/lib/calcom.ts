import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";

const CAL_API_BASE = "https://api.cal.com/v2";
const CAL_API_VERSION = "2026-02-25";
const PROVIDER = "calcom";

export type CalBookingRequest = {
  bookingLink: string;
  startsAt: string;
  durationMinutes: number;
  attendee: { name: string; email: string; timeZone: string };
  guests: string[];
  meetingType?: "online" | "in_person";
  meetingUrl?: string | null;
  location?: string | null;
};

export type CalBooking = {
  uid: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  meetingUrl: string | null;
  location: string | null;
  meetingType: "online" | "in_person";
  guests: string[];
  status: string;
};

function cleanApiKey(value: unknown): string | null {
  const key = typeof value === "string" ? value.trim() : "";
  return /^cal_[A-Za-z0-9_-]{12,}$/.test(key) ? key : null;
}

export function parseCalBookingLink(value: string):
  | { eventTypeSlug: string; username: string }
  | { eventTypeSlug: string; teamSlug: string; organizationSlug?: string }
  | null {
  try {
    const raw = value.trim();
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.hostname !== "cal.com" && !url.hostname.endsWith(".cal.com")) return null;
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] === "team" && parts.length >= 3) {
      return { teamSlug: parts[1], eventTypeSlug: parts[2] };
    }
    if (parts[0] === "org" && parts[2] === "team" && parts.length >= 5) {
      return { organizationSlug: parts[1], teamSlug: parts[3], eventTypeSlug: parts[4] };
    }
    if (parts.length >= 2) return { username: parts[0], eventTypeSlug: parts[1] };
    return null;
  } catch {
    return null;
  }
}

async function requestCal(path: string, apiKey: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CAL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "cal-api-version": CAL_API_VERSION,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as {
    error?: { message?: string } | string;
    message?: string;
  } | null;
  if (typeof body?.error === "string") return body.error;
  return body?.error?.message || body?.message || `Cal.com returned ${response.status}.`;
}

function rejectsCustomDuration(message: string): boolean {
  return /lengthInMinutes/i.test(message) && /does not have multiple possible lengths/i.test(message);
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function returnedLocation(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const location = value as { address?: unknown; link?: unknown };
  if (typeof location.address === "string") return location.address.trim() || null;
  if (typeof location.link === "string") return location.link.trim() || null;
  return null;
}

function bookingPayload(
  eventType: NonNullable<ReturnType<typeof parseCalBookingLink>>,
  input: CalBookingRequest,
  includeDuration: boolean,
) {
  return {
    ...eventType,
    start: input.startsAt,
    attendee: input.attendee,
    guests: input.guests,
    ...(includeDuration ? { lengthInMinutes: input.durationMinutes } : {}),
    meetingUrl: input.meetingType === "in_person" ? undefined : input.meetingUrl || undefined,
    metadata: { source: "omni-crm" },
  };
}

export async function validateCalApiKey(value: unknown): Promise<string> {
  const apiKey = cleanApiKey(value);
  if (!apiKey) throw new Error("Enter a Cal.com API key beginning with cal_.");
  const response = await requestCal("/me", apiKey);
  if (!response.ok) throw new Error(response.status === 401 ? "That Cal.com API key is invalid or expired." : await responseError(response));
  return apiKey;
}

export async function saveCalApiKey(userId: string, apiKey: string): Promise<void> {
  await prisma.integrationCredential.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { userId, provider: PROVIDER, secret: encrypt(apiKey) },
    update: { secret: encrypt(apiKey) },
  });
}

export async function deleteCalApiKey(userId: string): Promise<void> {
  await prisma.integrationCredential.deleteMany({ where: { userId, provider: PROVIDER } });
}

export async function calApiKey(userId: string): Promise<string | null> {
  const fromEnvironment = cleanApiKey(process.env.CAL_API_KEY);
  if (fromEnvironment) return fromEnvironment;
  const credential = await prisma.integrationCredential.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
    select: { secret: true },
  });
  if (!credential) return null;
  try {
    return cleanApiKey(decrypt(credential.secret));
  } catch {
    return null;
  }
}

export async function createCalBooking(apiKey: string, input: CalBookingRequest): Promise<CalBooking> {
  const eventType = parseCalBookingLink(input.bookingLink);
  if (!eventType) throw new Error("Use a Cal.com event link such as cal.com/you/30min.");
  let response = await requestCal("/bookings", apiKey, {
    method: "POST",
    body: JSON.stringify(bookingPayload(eventType, input, true)),
  });
  if (!response.ok) {
    const message = await responseError(response);
    if (!rejectsCustomDuration(message)) throw new Error(message);
    response = await requestCal("/bookings", apiKey, {
      method: "POST",
      body: JSON.stringify(bookingPayload(eventType, input, false)),
    });
    if (!response.ok) throw new Error(await responseError(response));
  }
  const payload = await response.json() as {
    data?: {
      uid?: string;
      start?: string;
      end?: string;
      duration?: number;
      meetingUrl?: string;
      location?: unknown;
      guests?: string[];
      status?: string;
    };
  };
  const booking = payload.data;
  if (!booking?.uid || !booking.start || !booking.end) throw new Error("Cal.com created the booking but returned incomplete details.");
  const meetingType = input.meetingType === "in_person" ? "in_person" : "online";
  const requestedLocation = input.location?.replace(/\s+/g, " ").trim().slice(0, 300) || null;
  let location = returnedLocation(booking.location);
  if (meetingType === "in_person" && requestedLocation) {
    const locationResponse = await requestCal(`/bookings/${encodeURIComponent(booking.uid)}/location`, apiKey, {
      method: "PATCH",
      body: JSON.stringify({ location: { type: "address", address: requestedLocation } }),
    });
    if (!locationResponse.ok) {
      throw new Error(`Cal.com created the booking, but could not add the location. ${await responseError(locationResponse)}`);
    }
    location = requestedLocation;
  }
  const returnedDuration = Math.round((new Date(booking.end).getTime() - new Date(booking.start).getTime()) / 60_000);
  const meetingUrl = meetingType === "online"
    ? safeHttpUrl(booking.meetingUrl) || safeHttpUrl(location) || safeHttpUrl(input.meetingUrl)
    : null;
  return {
    uid: booking.uid,
    startsAt: booking.start,
    endsAt: booking.end,
    durationMinutes: booking.duration || (returnedDuration > 0 ? returnedDuration : input.durationMinutes),
    meetingUrl,
    location: meetingType === "in_person" ? requestedLocation || location : null,
    meetingType,
    guests: booking.guests || input.guests,
    status: booking.status || "accepted",
  };
}
