import assert from "node:assert/strict";
import test from "node:test";
import { buildCallInvite, parseCallInvite } from "./call-invite";

test("call invites round-trip through the message body", () => {
  const body = buildCallInvite({
    title: "  Call   with Alex  ",
    startsAt: new Date("2026-11-12T19:30:00.000Z"),
    durationMinutes: 30,
    meetingUrl: "meet.google.com/abc-defg-hij",
    guests: ["Alex@Example.com", "ada@example.com"],
    guestTimeZone: "Europe/London",
  });
  const invite = parseCallInvite(body);
  assert.equal(invite?.title, "Call with Alex");
  assert.equal(invite?.startsAt, "2026-11-12T19:30:00.000Z");
  assert.equal(invite?.endsAt, "2026-11-12T20:00:00.000Z");
  assert.equal(invite?.meetingUrl, "https://meet.google.com/abc-defg-hij");
  assert.deepEqual(invite?.guests, ["alex@example.com", "ada@example.com"]);
  assert.equal(invite?.guestTimeZone, "Europe/London");
  assert.equal(invite?.calBookingUid, null);
  assert.match(body, /30 min/);
});

test("ordinary calendar links and malformed dates do not become call cards", () => {
  assert.equal(parseCallInvite("https://calendar.google.com/calendar/render?action=TEMPLATE"), null);
  assert.equal(parseCallInvite("📅 Call invite\nhttps://calendar.google.com/calendar/render?action=TEMPLATE&dates=nope"), null);
});

test("unsafe meeting schemes are omitted", () => {
  const body = buildCallInvite({
    title: "Review",
    startsAt: new Date("2026-11-12T19:30:00.000Z"),
    durationMinutes: 15,
    meetingUrl: "javascript:alert(1)",
  });
  assert.equal(parseCallInvite(body)?.meetingUrl, null);
  assert.doesNotMatch(body, /javascript:/);
  assert.deepEqual(parseCallInvite(body)?.guests, []);
  assert.equal(parseCallInvite(body)?.guestTimeZone, null);
});

test("rejects invalid guest time zones", () => {
  const body = buildCallInvite({
    title: "Review",
    startsAt: new Date("2026-11-12T19:30:00.000Z"),
    durationMinutes: 15,
    guestTimeZone: "Not/A_Time_Zone",
  });
  assert.doesNotMatch(body, /Guest time zone:/);
  assert.equal(parseCallInvite(body)?.guestTimeZone, null);
});

test("round-trips the Cal.com booking id", () => {
  const body = buildCallInvite({
    title: "Booked call",
    startsAt: new Date("2026-11-12T19:30:00.000Z"),
    durationMinutes: 30,
    guests: ["guest@example.com"],
    calBookingUid: "booking_uid_123",
  });
  assert.equal(parseCallInvite(body)?.calBookingUid, "booking_uid_123");
});
