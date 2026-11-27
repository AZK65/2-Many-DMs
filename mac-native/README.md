# Native Mac client preview

A SwiftUI inbox for 2ManyDMs, with native Mac menus and keyboard shortcuts, a translucent conversation list, and a Liquid Glass composer on macOS 26. This is a source preview of a native client, not yet a standalone replacement for the full workspace.

The client connects to the **existing local service**. Telegram, WhatsApp, X and the other connectors continue running there. Opening this app does not create a second platform session or require connecting the accounts again.

## Build and open

Requirements: macOS 14 or later and Swift 5.10 or later (Xcode or Apple's Command Line Tools). From the repository root:

```sh
bash mac-native/build.sh
open '.local/native-mac/2ManyDMs.app'
```

Start the normal 2ManyDMs service using the repository's setup instructions first. The client defaults to `http://127.0.0.1:3000`. If your local service uses another port, change **Settings → Local inbox**. Only loopback addresses are accepted by this version.

For an isolated design preview with synthetic conversations and no network requests:

```sh
open '.local/native-mac/2ManyDMs Preview.app'
```

Both app bundles are built locally and ad hoc signed by default. A Developer ID can be supplied using `TMD_MAC_SIGN_IDENTITY`; a signed, hardened, notarized distribution package and a bundled service installer are separate release work. Do not treat this development build as a notarized public download.

## Included

- A native split view with a compact toolbar, collapsible sidebar, and inbox/network filters in the toolbar menu.
- Unified conversation list, network filtering, unread and request views.
- Chat and saved-message search, including jumping to a result.
- Recent messages, explicit older-history loading, and connection status.
- Text messages, one attachment up to 25 MB, replies and selectable/copyable text.
- Downloaded photos and avatars from the local service.
- Per-chat drafts, persistent protection for a send interrupted by a crash or timeout, and visible failed/unknown delivery states.
- System, light and dark appearances; native menu and accessibility labels.
- Live inbox events with a polling fallback for older local services.
- Opened conversations reappear from a bounded memory cache while refreshing; unchanged inbox snapshots do not rebuild the list.
- Grouped message bubbles, smooth new-message scrolling, and an AppKit composer that preserves the caret, undo and input-method composition.
- A sliding Details inspector with copyable contact information, pin/done controls, shared photos, a photo viewer, links, files and pinned messages. Shared items come from the saved-history service, independently of the visible message page.

Keyboard shortcuts: **⌘F** search, **⌘I** show/hide Details, **Return** or **⌘Return** send, **⇧Return** or **⌥Return** new line, **⌘R** refresh, **⌘,** settings, **⇧⌘O** open the selected chat in the full workspace. Click the contact name to open Details; its X closes it.

Account setup, translation/OCR controls, edit/delete/reactions, group administration and other advanced workflows currently open in the full workspace. The client does not bundle the connectors, add an offline history database, or provide a remote authenticated service connection yet. Closing the local service makes the inbox unavailable; drafts remain on this Mac.

## Glass and accessibility

On macOS 26, the composer uses Apple's documented `NSGlassEffectView`. A small Objective-C bridge resolves that public class at runtime so the package can also compile with older command-line SDKs. Older systems and Reduce Transparency use `NSVisualEffectView` instead. Content remains on ordinary surfaces; glass is reserved for controls.

Reduce Motion disables message, composer, Details-panel and tab animations. New incoming messages scroll into view only when you are already at the bottom; a new-message control appears while you are reading earlier messages. Exact message times remain available on hover.

## Data and delivery

Chat, photo and event requests use an ephemeral session and refuse redirects. The app reads the local API without copying connector sessions or keys. Only choosing a chat marks it read; background refreshes do not. Native client drafts and in-flight send identities are stored in `~/Library/Application Support/2ManyDMs`, separately for each local service origin, with owner-only file permissions. Attachments are not uploaded until Send is pressed.

Sends use the existing service's client message identity. The app saves that identity before dispatch and never automatically repeats an ambiguous send. If delivery cannot be confirmed, review the full workspace; the native client can reconcile a saved receipt, or you can explicitly acknowledge that review. Synthetic preview mode keeps everything in memory.

## Verification

```sh
bash mac-native/test.sh
# Optional: read-only compatibility check against an already-running localhost:3000 service.
# Does not send messages or mark conversations read.
bash mac-native/test.sh --live
```

The contract checks cover loopback isolation, URL encoding, overlapping history, conservative X preview suppression, preserving edits/deletions/media/delivery, ambiguous-send behavior, and restoring an in-flight identity. Build verification and UI review should cover light/dark appearances, a narrow sidebar, search, per-chat drafts, preview sending, and keyboard controls. A live platform send is a separate test requiring an authorized recipient.
