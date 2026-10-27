# Workspace design

The workspace uses locally bundled Geist Sans, a neutral palette and the existing configurable
green accent. Platform colors identify the source; they are not an extra action
palette. Keep data, warning and delivery states semantically distinct.

## Surfaces

- `WorkspaceHeader` owns primary navigation on Inbox, Board, Tasks, Network,
  Reply Lab, Recap, Automations, Spend and Listening. More holds secondary pages,
  copied emails and appearance. Navigation does not belong in the inbox filters.
  On every workspace page, desktop navigation remains a fixed 64px app rail; mobile retains a compact
  top bar. The conversation list is a distinct 320px pane beside that rail.
- The Inbox heading, search, lifecycle views and existing funnel form the list
  controls. New secondary filters belong in the funnel, not another toolbar.
- Chat rows form a continuous list, with an inset accent edge on the selected
  row, compact avatars and stronger unread names. Keyboard users can select rows
  and reach contextual actions. Lifecycle views use underlines, not pill cards.
- The conversation header prioritizes identity, search, Done and History.
  Conversation options contains multi view, translation, alerts and archiving.
  History warnings must never disappear solely for visual cleanliness.
- The inbox can collapse to an avatar rail on desktop. Preserve the current
  filters, scroll anchor and selected conversation. Unread counts, platform
  badges and accessible full names remain available in compact mode.
  The compact pane is 64px with 48px hit targets and a small selection marker.
  Combine mention and unread count into one badge; reserve accent for mentions.
  Platform badges stay small and names/pinned state are available on hover and
  to screen readers. Initials ignore punctuation and group-name separators.
  `Avatar` uses the runtime image route, shows initials on broken images, and
  retries when a refreshed photo has a new versioned URL.
- The composer starts as a compact one-line bar (58px on desktop), expanding
  into a full-width writing area with a bottom toolbar for longer drafts. It
  shrinks back when cleared; a short-draft threshold prevents wrapping loops.
  Attachments, emoji and dictation are
  directly available; Writing tools holds AI, autocorrect and snippets. Send is
  labeled and aligned bottom-right. Preserve all keyboard/send behavior.
- Message bubbles have small corners and subtle incoming/outgoing surfaces.
  Sender names and timestamps sit outside the message fill for clearer hierarchy.
  Consecutive messages share a visual run. Only group members repeat identity;
  actions live in a per-message disclosure instead of reserving a whole toolbar.
- The Sales Agent lives in the workspace header, not over the send button.
- Contact labels are disclosed beside a sender rather than repeated as bright
  CRM banners in every message. Contact details retain the full information.
- The Details inspector separates Info from Shared (pinned messages, media and
  links). On narrow layouts it overlays the thread rather than squeezing it.

## Behavior

- Use `OverlayPortal` for dialogs: viewport positioning, topmost Escape handling,
  focus containment/restoration and scroll locking. Exiting overlays must not
  intercept clicks. Keep busy-state dismissal guards in transactional dialogs.
- Use `MenuDetails` for action disclosures, not blur-closing native details.
  It renders the panel outside clipping containers, fits it within the viewport,
  and closes on outside click, Escape or a `data-close-menu` action. Nested
  translation and keyword settings expand inline instead of opening off-screen.
- Sidebar width transitions and page/menu fades respect reduced motion. Do not
  animate the app rail or transform page roots containing fixed-position UI.

No redesign changes sync, delivery, Done, filtering or retention semantics.
Preserve drafts, scroll anchoring, input focus and identity warnings. Keep saved
data separate from live connection health. Motion honors reduced-motion settings.
Deep-link selection is applied once on initial load; refreshing inbox data must
not reopen that original chat or undo mobile back navigation.

Verify light/dark, a 320px inbox sidebar, phone width, long drafts, empty states,
keyboard navigation and non-default filters. Do not send real messages for UI QA.
Build in an isolated output directory so the live app is not disrupted.
