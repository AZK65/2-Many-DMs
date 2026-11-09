import assert from "node:assert/strict";
import test from "node:test";
import { parseCalBookingLink } from "./calcom";

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
