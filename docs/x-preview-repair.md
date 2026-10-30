# X preview/history repair (October 26, 2026)

Inbox previews are provisional, not native messages. Keep the existing warning
until an actual X message ID is recovered; do not hide it to mask partial sync.

## Regressions addressed

- Rounded `now`/`1m` timestamps plus polling jitter minted duplicate preview IDs
  just over 60 seconds apart. Stabilize approximate dates with bounded tolerance.
- The inactive headless history tab could keep returning an old virtual viewport.
  Activate that connector-owned tab before reading, target X's native message
  scroller, and wait at most 12 seconds for the newest observed preview to appear.
  Restore the passive inbox as the active connector tab after parking history.
- Require the latest preview's direction, content/media type, and date range to
  match native history before a repair can complete. Keep partial work retryable.
- Emoji-only messages use article `aria-describedby`, not `message-text-*`.
- Date-separator detection must exclude all message content (a DM saying
  "Yesterday" is not a date separator).
- Keep native DOM order within minute-precision runs using millisecond ordering
  offsets inside that minute. These offsets are ordering metadata, not claimed
  exact send times. Explicit timestamps and locally recorded send times remain.
- When a leading virtualized bubble lacks its date separator, retain a previously
  stored date only by the same native ID. Never invent a current date.

## Safe reconciliation

After native history is saved, reconcile only exact-text, same-direction preview
copies within 130 seconds of one unambiguous native match from that pass. Native
IDs and real repeated messages are never deleted. Annotated, pinned, media,
referenced, translated, or locally sent preview rows are excluded. Private JSON
recovery copies are written to `.x_preview_backups/` before removing generated
duplicates. Backup failure aborts deletion. The directory is excluded from Git.

The existing 60-second history pace, request cooldowns, and retry limits remain.
No extra frequent history poll or account reset is introduced.

## Account-wide snapshot reconciliation

Inbox rows are observations, not native message events. A changed clock alone
must not insert another identical preview, including absolute clock labels and
re-rendered request rows. Successful observation checkpoints survive restarts;
changed content still publishes immediately and native IDs retain true repeats.

On connector startup, scan every saved X conversation with preview rows in that
account. Completed history checkpoints can reconcile a single-message request
even when its preview clock drifted by more than two minutes. Require one
unambiguous native match and uninterrupted exact-text, same-direction copies
observed before that completed read. Failed/partial reads, newer observations,
different intervening messages, and multiple native repeats are not proof.
The same reconciliation runs after future successful history reads. Preserve
all existing annotation/reference protections and write recovery copies first.
No provider navigation is needed for the startup scan.

## Verification

`npx tsx --test sync/x-history.test.ts sync/x-live-inbox.test.ts sync/x-attachment.test.ts sync/x-store.test.ts`

`npx tsc --noEmit` and `git diff --check`.

`scripts/check-x-attachments.ts` serves an isolated local DOM fixture; inspect its
results in the browser. Its content-security policy blocks external test URLs.

Live reproduction: FrostyCanada. The native conversation contained seven messages
on October 26 while Omni had only six rows, including two duplicate previews.
After repair all seven native messages were recovered, including the missing
waitlist message, preceding reply, and emoji-only message. No messages were sent.
