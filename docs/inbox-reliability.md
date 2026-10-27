# Inbox reliability

Connection state and message coverage are separate. The Omni menu displays the
last completed inbox check, pending history checks, deferred recovery, and platform
cooldowns. A connected WhatsApp socket does not assert complete phone history.
No badge promises all older messages or expired attachments have been recovered.

The History menu on each chat exposes known pending checks and safe links to the
native service. X has a direct conversation link; WhatsApp and Telegram open their
inboxes rather than guessing a group destination from a member's phone or handle.
X inbox-preview records are explicitly labelled until replaced by native messages.

Filters live in the existing funnel: platform, conversation type, unread mentions,
opened but unanswered chats, and pending history checks. Broadcast Telegram
channels remain in All but are excluded from Reply. Ordinary groups remain in
Reply unless explicitly filtered; the app does not guess which client matters.
The latest confirmed message determines the reply obligation. Pending, failed,
and unconfirmed outgoing attempts remain visible but do not dismiss an unanswered
incoming message. Opening a chat does not count as answering it.

The inbox anchors visible rows across polling, reply removal, and reordered history.
Changing filters intentionally returns to the top. Existing send grace periods,
manual Done, archived/hidden chats, and rate-limit protections are retained.

Telegram descending history uses the current page boundary for both offsetId and
maxId because GramJS takes their maximum. X request recovery targets the request
scroll container rather than the general sidebar, and checks the same native ID
in General if a request is no longer found. Failed repairs stay in the durable
queue during backoff, rather than relying on rediscovery after three failures.

Verification: run `node --import tsx --test src/lib/sync-health.test.ts
src/lib/inbox-query.test.ts src/lib/connection-status.test.ts
sync/telegram-history-sync.test.ts sync/x-dom-scroll.test.ts
sync/x-live-inbox.test.ts`, then `npx tsc --noEmit` and `git diff --check`.
