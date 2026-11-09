import { NextRequest, NextResponse } from "next/server";
import { calApiKey, createCalBooking } from "@/lib/calcom";
import { clientIp, getCurrentUser } from "@/lib/currentUser";
import { sameSetupOrigin } from "@/lib/setup-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  if (!sameSetupOrigin(req)) return NextResponse.json({ error: "Open the scheduler from Omni to create a booking." }, { status: 403 });
  const body = await req.json().catch(() => null) as {
    bookingLink?: unknown;
    startsAt?: unknown;
    durationMinutes?: unknown;
    attendee?: { name?: unknown; email?: unknown; timeZone?: unknown };
    guests?: unknown;
    meetingUrl?: unknown;
  } | null;
  const bookingLink = typeof body?.bookingLink === "string" ? body.bookingLink.trim() : "";
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : "";
  const durationMinutes = Number(body?.durationMinutes);
  const attendeeName = typeof body?.attendee?.name === "string" ? body.attendee.name.trim() : "";
  const attendeeEmail = typeof body?.attendee?.email === "string" ? body.attendee.email.trim().toLowerCase() : "";
  const timeZone = typeof body?.attendee?.timeZone === "string" ? body.attendee.timeZone : "";
  const guests = Array.isArray(body?.guests)
    ? [...new Set(body.guests.filter((email): email is string => typeof email === "string").map(email => email.trim().toLowerCase()))]
    : [];

  if (!bookingLink) return NextResponse.json({ error: "Add your Cal.com event link in Settings." }, { status: 400 });
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime()) || new Date(startsAt).getTime() <= Date.now())
    return NextResponse.json({ error: "Choose a future start time." }, { status: 400 });
  if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 240)
    return NextResponse.json({ error: "Choose a valid call duration." }, { status: 400 });
  if (!attendeeName || !EMAIL.test(attendeeEmail))
    return NextResponse.json({ error: "Add the primary guest's name and email." }, { status: 400 });
  if (!timeZone) return NextResponse.json({ error: "The guest time zone is missing." }, { status: 400 });
  if (guests.length > 20 || guests.some(email => !EMAIL.test(email)))
    return NextResponse.json({ error: "Check the guest email list. Up to 20 guests are supported." }, { status: 400 });

  const user = await getCurrentUser(clientIp(req));
  const apiKey = await calApiKey(user.id);
  if (!apiKey) return NextResponse.json({ error: "Connect your Cal.com API key in Settings first.", code: "CAL_NOT_CONNECTED" }, { status: 503 });

  try {
    const booking = await createCalBooking(apiKey, {
      bookingLink,
      startsAt: new Date(startsAt).toISOString(),
      durationMinutes,
      attendee: { name: attendeeName, email: attendeeEmail, timeZone },
      guests: guests.filter(email => email !== attendeeEmail),
      meetingUrl: typeof body?.meetingUrl === "string" ? body.meetingUrl : null,
    });
    return NextResponse.json({ booking }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cal.com could not create this booking." }, { status: 422 });
  }
}
