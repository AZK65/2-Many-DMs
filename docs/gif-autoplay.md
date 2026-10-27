# GIF playback

GIF images already animate in the image renderer. WhatsApp and Telegram also
send GIFs as videos; `Message.mediaIsGif` retains their native animation marker.
X uses explicit native GIF markers / the GIF video CDN path, not video length,
muting, or looping heuristics. Unknown videos remain click-to-play.

The inline video player loops GIFs muted while visible, pauses off-screen or in a
background tab, and offers a labeled Play/Pause control. Reduced-motion users
must press Play. Browser autoplay rejection shows Play, not a broken-file error.
Ordinary video preview behavior is unchanged. Clicking opens the existing viewer.

## Existing installs

Before deploying the generated client / restarting services:

1. `npx prisma generate`
2. `npx tsx scripts/enable-gif-media.ts --apply`

This only adds the boolean column if absent and labels WhatsApp videos when
retained native records confirm `gifPlayback`. It makes no platform requests and
does not change chat timestamps, unread counts, messages, or account sessions.
New installs receive the column through the Prisma schema as usual. Old Telegram
or X video GIFs without retained native metadata become recognizable when those
messages are next synced/recovered; never guess that every MP4 is a GIF.

Checks: `npx tsx --test src/lib/gif-media.test.ts sync/x-attachment.test.ts sync/x-store.test.ts`.
