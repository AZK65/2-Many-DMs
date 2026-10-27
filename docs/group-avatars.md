# Group photos and people

Groups keep their own picture when available. If it is missing or fails to
load, the inbox, compact rail, pinned chats, thread header and details panel
use a rounded collage of up to four known senders. Direct chat avatars remain
unchanged. Missing member pictures fall back to initials; cached image failures
are checked after hydration as well as through the image error event.

The source is inbound messages with an exact `senderContactId` in the same
conversation, excluding group contacts and outgoing messages. This is not a
complete/current membership roster. The header opens the existing details
panel, labeled **People seen in this group**, where all observed senders and
available photos can be viewed. Identical names never join different identities.

Photo selection favors available images, then people who appear in fewer
groups (to avoid showing the same shared teammates everywhere). Up to four
distinct image URLs are selected, with stable identity ordering. This ranking
does not infer anyone's job or role. The count includes all observed senders,
not just the four preview contacts.

One batched local query is cached for 30 seconds with in-flight deduplication.
The normal five-second message poll is unchanged. A separate conditional
appearance refresh runs once a minute while the page is visible and on return
to the page. It updates only pictures and group previews, never inbox ordering,
unread state, selection, drafts, or contact notes. No connector API calls or
new photo-download jobs are triggered by displaying a group.

Verification: `npx tsx --test src/lib/group-avatars.test.ts`, TypeScript and
diff checks. Browser QA covered the real Bat Partners chat, expanded and
collapsed inbox, header-to-details navigation, light/dark avatars, broken
group/member images, no photos, no observed people, one sender, group-photo
priority, and unchanged direct chat rendering. Conditional appearance requests
return 304 when unchanged.
