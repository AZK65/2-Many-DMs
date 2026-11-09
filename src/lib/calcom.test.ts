import assert from "node:assert/strict";
import test from "node:test";
import { createCalBooking, parseCalBookingLink } from "./calcom";

test("parses personal Cal.com booking links", () => {
  assert.deepEqual(parseCalBookingLink("cal.com/arsalaan/30min?date=2026-11-12"), {
    username: "arsalaan",
    eventTypeSlug: "30min",
  });
});

test("parses team and organization booking links", () => {
  assert.deepEqual(parseCalBookingLink("https://cal.com/team/omni/demo"), {
    teamSlug: "omni",
    eventTypeSlug: "demo",
  });
  assert.deepEqual(parseCalBookingLink("https://cal.com/org/acme/team/sales/intro"), {
    organizationSlug: "acme",
    teamSlug: "sales",
    eventTypeSlug: "intro",
  });
});

test("rejects non-Cal.com and incomplete links", () => {
  assert.equal(parseCalBookingLink("https://example.com/me/30min"), null);
  assert.equal(parseCalBookingLink("https://cal.com/only-one-part"), null);
});

test("retries fixed-duration event types without lengthInMinutes", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (bodies.length === 1) {
      return Response.json({
        error: {
          message: "Can't specify 'lengthInMinutes' because event type does not have multiple possible lengths. Please, remove the 'lengthInMinutes' field from the request.",
        },
      }, { status: 400 });
    }
    return Response.json({
      data: {
        uid: "booking_123",
        start: "2026-11-12T20:00:00.000Z",
        end: "2026-11-12T21:00:00.000Z",
        status: "accepted",
      },
    }, { status: 201 });
  };

  try {
    const booking = await createCalBooking("cal_test_key_123456", {
      bookingLink: "cal.com/chris/celeste",
      startsAt: "2026-11-12T20:00:00.000Z",
      durationMinutes: 30,
      attendee: { name: "Test Guest", email: "guest@example.com", timeZone: "America/Toronto" },
      guests: [],
    });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].lengthInMinutes, 30);
    assert.equal("lengthInMinutes" in bodies[1], false);
    assert.equal(booking.durationMinutes, 60);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps the selected duration for multi-duration event types", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({
      data: {
        uid: "booking_456",
        start: "2026-11-12T20:00:00.000Z",
        end: "2026-11-12T20:30:00.000Z",
        duration: 30,
        status: "accepted",
      },
    }, { status: 201 });
  };

  try {
    await createCalBooking("cal_test_key_123456", {
      bookingLink: "cal.com/chris/celeste",
      startsAt: "2026-11-12T20:00:00.000Z",
      durationMinutes: 30,
      attendee: { name: "Test Guest", email: "guest@example.com", timeZone: "America/Toronto" },
      guests: [],
    });
    assert.equal(bodies[0].lengthInMinutes, 30);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adds an in-person address to the confirmed Cal.com booking", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method || "GET",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    if (calls.length === 1) {
      return Response.json({
        data: {
          uid: "booking_in_person",
          start: "2026-11-12T20:00:00.000Z",
          end: "2026-11-12T20:30:00.000Z",
          duration: 30,
          status: "accepted",
        },
      }, { status: 201 });
    }
    return Response.json({ status: "success" });
  };

  try {
    const booking = await createCalBooking("cal_test_key_123456", {
      bookingLink: "cal.com/chris/coffee",
      startsAt: "2026-11-12T20:00:00.000Z",
      durationMinutes: 30,
      attendee: { name: "Test Guest", email: "guest@example.com", timeZone: "America/Toronto" },
      guests: [],
      meetingType: "in_person",
      location: "123 King St W, Toronto",
    });
    assert.equal(calls.length, 2);
    assert.equal("meetingUrl" in calls[0].body, false);
    assert.match(calls[1].url, /\/bookings\/booking_in_person\/location$/);
    assert.equal(calls[1].method, "PATCH");
    assert.deepEqual(calls[1].body, {
      location: { type: "address", address: "123 King St W, Toronto" },
    });
    assert.equal(booking.meetingType, "in_person");
    assert.equal(booking.location, "123 King St W, Toronto");
    assert.equal(booking.meetingUrl, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
