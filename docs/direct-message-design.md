# Direct message presentation

Individual conversations use connected, borderless message runs rather than
the group-thread speaker layout. A contact photo (or initials fallback) appears
once per incoming run and opens the existing contact panel. Messages keep their
original order, identifiers, content, and delivery state.

- Existing five-minute, day, and direction boundaries define runs.
- Text uses the existing Geist font at 16px, with 24px line height.
- Consecutive bubbles join visually with smaller inner corners and tighter gaps.
- Routine timestamps appear at the end of a run. Each message retains its exact
  timestamp in its hover title and accessible time element.
- Failed, unconfirmed, pending, focused, and unverified X preview messages keep
  visible metadata. No delivery or history verification is inferred from styling.
- Group chat rules, connector workers, and automatic Telegram media remain intact.

Verification: 15 presentation/media tests, TypeScript, production build, and
diff whitespace checks passed. Live-data preview covered WhatsApp, Telegram,
and X; both themes; expanded/collapsed sidebar; 390px phone width; keyboard
profile opening; reply menu; and composer growth (58px compact / 146px paragraph).
No test messages were sent. Test drafts were cleared.
