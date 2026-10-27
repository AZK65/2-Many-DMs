# Avatar backfill

Photo refresh is independent of message history. The worker's local-only
`POST /avatars/backfill` starts a persisted pass over connected accounts;
`GET /avatars/backfill` reports real progress. Posting while it runs resumes
the same pass instead of duplicating it. The queue lives in
`.local/avatar-backfill.json` and survives worker restarts.

- Missing photos first, then newest conversations, deduplicated per account/contact.
- One request at a time per account, at least four seconds apart, yielding to
  outbound activity and connector recovery. Flood waits pause the whole account.
- WhatsApp and Telegram request only profile/group photos. Private, absent or
  inaccessible pictures do not clear an existing avatar.
- X uses photo URLs already observed during normal inbox polling, or reconnects
  a cached local photo. It does not navigate chats or bypass X cooldowns. Cached
  results are counted separately from fresh downloads.
- Contact identity and linked account/chat are checked before writing. No names,
  messages, unread state, application fields or automations are modified.
- Downloads receive versioned URLs. The runtime image route serves photos added
  after web startup; the Avatar component also supports older unversioned URLs.

Unavailable is not a successful photo download. Progress exposes downloaded,
cached, unavailable, failed and pending counts separately. Do not promise a
photo when the source account does not make one available.
