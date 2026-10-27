# Message and attachment retention

The worker journals every normalized incoming message before its database write.
Failed writes are replayed every 15 seconds and on restart, as historical imports
so recovery does not generate new unread counts or automated outreach.

Missing attachments are queued durably and retried independently: one operation
per account, at least 15 seconds apart (120 seconds for X), with exponential
backoff up to 24 hours. A task keeps ownership until the actual download settles.
X additionally enforces its shared history pacing, cooldown and send guards.
Disconnected accounts are not contacted. Successful files remain in public/media.

At startup, up to 1,000 missing/remote attachments from the last 72 hours are
seeded from connected accounts. All newly received/backfilled attachment records
are queued regardless of message age. This is not a promise to recover content
that the platform no longer provides. Automatic downloads respect MEDIA_MAX_MB
(currently 25 MB by default); manual Telegram recovery retains its separate cap.

WhatsApp Baileys stores received native records using protobuf under
.local/whatsapp-messages/<accountId>, allowing attachment retries and quoted
replies after a restart. Both native records and the retention journals under
.local/sync-retention are encrypted with per-directory random keys in .key files,
restricted to the local user, and excluded from git. Back up these folders WITH
their keys alongside the database, media and authentication profiles. The keys
are local files, not protection against an attacker who controls this OS account.

Baileys uses the same account ID as the previous web connector. The worker maps
phone JIDs back to the existing @c.us CRM format; socket operations convert them
to @s.whatsapp.net. Group and LID IDs remain unchanged. Browser login credentials
are not convertible to Baileys; switching can require a fresh phone QR scan.

Only one WhatsApp driver should run for this account. Keep the legacy default
Baileys account disabled; do not enable WHATSAPP_ENABLED to create a second
environment-managed connection. Driver changes require a controlled worker
restart, not merely /reload (which keeps existing adapters running).

Messages already saved remain available offline. New messages cannot be archived
while the Mac/worker is off or a platform session is disconnected; normal
checkpointed catch-up still handles those gaps within platform limits.
