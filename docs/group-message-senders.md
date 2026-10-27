# Group message senders

Incoming group messages use a 40px speaker avatar next to a readable, colored name. Consecutive messages from the same person share that header; their text stays aligned below it inside softly filled, rounded bubbles with a subtle outline in both themes. Direct chats and outgoing delivery states are unchanged.

- Runs use the sender's platform key or contact ID, never name equality. Unidentified messages remain separate.
- Speaker colors are deterministic across groups and reloads, with light/dark variants. Names and photos remain the primary identifiers; colors may repeat in large groups.
- Photos come only from the message's linked sender contact. Missing or broken photos show colored initials. An unidentified sender never inherits the group picture or group name.
- Clicking a known sender's name or photo opens the existing member profile. Both controls are keyboard-accessible.
- Reply previews use the original sender's color only when that exact original message is loaded, not by guessing from a name.
- Long quotes, names, and media stay within the message column on narrow layouts. No extra requests to messaging platforms are added by rendering this layout.

Regression checks: `npx tsx --test src/lib/message-sender.test.ts src/lib/group-avatars.test.ts`, `npx tsc --noEmit`, and `git diff --check`.
