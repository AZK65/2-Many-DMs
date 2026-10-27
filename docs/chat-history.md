# Automatic chat history

Messages are stored in Omni's local database; opening or closing a chat does
not remove them. Connector catch-up fills missed ranges without resending
messages or marking imported messages unread.

- Telegram runs catch-up at worker startup and every five minutes. It discovers
  all dialogs at startup and daily, refreshing the latest 100 dialogs between
  full discoveries. Each pass saves at most 20 pages of 100 messages, yielding
  to outbound activity. A per-account checkpoint records completed ranges and
  incomplete page cursors under `.chat-history/` in `DATA_DIR` (or the project).
- First-time Telegram recovery covers the last 72 hours, plus up to 20 recent
  messages in older inactive chats. After establishing a checkpoint, catch-up
  fills everything since that checkpoint, even after a longer outage. A daily
  recent-range check also catches gaps when the latest message ID is unchanged.
- X continuously records inbox updates and uses its existing paced native
  message repair queue. Once daily it also queues saved chats active within
  seven days, including those outside the rendered inbox. Unchanged previews
  no longer permanently suppress history checks. Queue/checkpoints persist in
  `.x_repair_state.json`; existing cooldowns and per-chat retry limits still apply.
- Existing saved history is retained. These routines do not promise a complete
  lifetime archive: older history can still require an explicit Backfill, and
  platform access restrictions can prevent recovery. Bulk Telegram catch-up
  saves attachment metadata without mass-downloading binaries.
- The Mac and sync worker must be running. Missed scheduled checks run after
  startup/reconnection; the worker cannot collect messages while the Mac sleeps.

`SYNC_BACKFILL=0` disables the old bulk startup import, **not** these routines.
No Codex heartbeat is needed to save messages. Logs use `[telegram] automatic
history ...` and `[x] daily history audit ...`; failures never advance a completed
Telegram checkpoint. Flood waits are persisted and honored after restarts.
