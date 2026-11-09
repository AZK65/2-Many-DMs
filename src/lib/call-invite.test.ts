import assert from "node:assert/strict";
import test from "node:test";
import { buildCallInvite, parseCallInvite } from "./call-invite";

test("online meeting receipts round-trip without a calendar template link", () => {
  const body = buildCallInvite({
    title: "  Meeting   with Alex  ",
    startsAt: new Date("2026-11-12T19:30:00.000Z"),
    durationMinutes: 30,
    meetingUrl: "meet.google.com/abc-defg-hij",
    guests: ["Alex@Example.com", "ada@example.com"],
    guestTimeZone: "Europe/London",
  });
  const invite = parseCallInvite(body);
  assert.equal(invite?.title, "Meeting with Alex");
  assert.equal(invite?.startsAt, "2026-11-12T19:30:00.000Z");
  assert.equal(invite?.endsAt, "2026-11-12T20:00:00.000Z");
  assert.equal(invite?.meetingUrl, "https://meet.google.com/abc-defg-hij");
  assert.equal(invite?.location, null);
  assert.equal(invite?.meetingType, "online");
  assert.deepEqual(invite?.guests, ["alex@example.com", "ada@example.com"]);
  assert.equal(invite?.guestTimeZone, "Europe/London");
  assert.equal(invite?.calBookingUid, null);
  assert.doesNotMatch(body, /calendar\.google\.com|cal\.com\//i);
  assert.match(body, /Invite: alex@example\.com, ada@example\.com/);
});

test("in-person receipts show and preserve the meeting location", () => {
  const body = buildCallInvite({
    title: "Coffee with Alex",
    startsAt: new Date("2026-11-12T19:30:00.000Z"),
    durationMinutes: 45,
    meetingType: "in_person",
    location: "  123 King St W, Toronto  ",
    guests: ["alex@example.com"],
    guestTimeZone: "America/Toronto",
    calBookingUid: "booking_uid_123",
  });
  const invite = parseCallInvite(body);
  assert.match(body, /^✅ Meeting booked/);
  assert.match(body, /Invite sent to: alex@example\.com/);
  assert.match(body, /Location: 123 King St W, Toronto/);
  assert.equal(invite?.location, "123 King St W, Toronto");
  assert.equal(invite?.meetingUrl, null);
  assert.equal(invite?.meetingType, "in_person");
  assert.equal(invite?.calBookingUid, "confirmed");
});

test("ordinary calendar links and malformed receipts do not become meeting cards", () => {
  assert.equal(parseCallInvite("https://calendar.google.com/calendar/render?action=TEMPLATE"), null);
  assert.equal(parseCallInvite("📅 Meeting details\nReview\nWhen: someday"), null);
});

test("unsafe meeting schemes are omitted", () => {
  const body = buildCallInvite({
    title: "Review",
    startsAt: new Date("2026-11-12T19:30:00.000Z"),
    durationMinutes: 15,
    meetingUrl: "javascript:alert(1)",
    guestTimeZone: "America/Toronto",
  });
  assert.equal(parseCallInvite(body)?.meetingUrl, null);
  assert.doesNotMatch(body, /javascript:/);
});

test("legacy Google Calendar invite messages remain readable", () => {
  const calendarUrl = new URL("https://calendar.google.com/calendar/render");
  calendarUrl.searchParams.set("action", "TEMPLATE");
  calendarUrl.searchParams.set("text", "Legacy call");
  calendarUrl.searchParams.set("dates", "20261112T193000Z/20261112T200000Z");
  calendarUrl.searchParams.set("location", "https://meet.google.com/abc-defg-hij");
  calendarUrl.searchParams.append("add", "guest@example.com");
  const body = ["📅 Call invite", "Legacy call", calendarUrl.toString(), "Guest time zone: Europe/London"].join("\n");
  const invite = parseCallInvite(body);
  assert.equal(invite?.title, "Legacy call");
  assert.equal(invite?.calendarUrl, calendarUrl.toString());
  assert.equal(invite?.meetingType, "online");
  assert.deepEqual(invite?.guests, ["guest@example.com"]);
});
