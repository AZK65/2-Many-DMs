# Telegram automatic media

Visible Telegram stickers and native GIFs load automatically in the existing
message card. No fetch button is shown unless loading fails. GIF autoplay keeps
the existing offscreen, page visibility, pause and reduced-motion protections.
Normal videos/documents do not start automatic downloads.

History remains lightweight: do not enable bulk attachment downloads while
backfilling. The visible-card queue skips offscreen work, serializes requests,
and backs off failed files for five minutes. The Telegram recovery queue is
shared with background retention, deduplicates message IDs, limits pending work,
paces downloads, yields to outgoing messages, and honors Telegram flood waits.
Automatic recovery uses the existing 25 MB default cap; explicit recovery keeps
its separate cap. Cached URLs are checked against an actual nonempty file.

Downloads are saved atomically. Static sticker/thumbnail bytes are validated.
Downloads reuse the authenticated primary Telegram connection for its own data
center, avoiding a redundant media connection/reconnect loop. Files in other
data centers continue to use GramJS's exported connections.
WebM stickers carry the native animation flag so they loop like GIFs. TGS/Lottie
stickers currently show Telegram's static thumbnail (not a Lottie player).
Unavailable/deleted/oversized attachments remain honest retry states. A broken
decoder cannot start an automatic retry loop, and a successful manual retry
refreshes the media element even when its URL has not changed.

Run `npx tsx --test src/lib/automatic-media.test.ts sync/media-recovery.test.ts
src/lib/gif-media.test.ts`, `npx tsc --noEmit`, and `git diff --check`. Review a
real missing sticker/GIF in light/dark mode and at narrow inbox width. Confirm
the binary is retained across reload, normal videos remain click-to-fetch, and
no outgoing message is sent by the test.
