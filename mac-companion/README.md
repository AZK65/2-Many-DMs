# OmniClipboard for macOS

Watches the system clipboard for email addresses and asks OmniCRM to match them
to their source DMs. It stores no other clipboard content.

Install and enable launch at login:

```bash
chmod +x mac-companion/install.sh
./mac-companion/install.sh
```

The default CRM address is `http://localhost:3000`. Use the envelope menu bar
item → **Set CRM URL…** after moving OmniCRM to an HTTPS host.

## Wispr Flow dictation

The installer also builds and installs **Omni Dictation**, a separate menu-bar
helper. It runs on the Mac where you type, even when Omni is hosted on a VPS.
Wispr Flow itself is installed separately from https://wisprflow.ai/downloads.

Click the mic beside Omni's message field for the setup checklist. Enable the
helper's Accessibility permission, configure Wispr's hands-free shortcut to
Control + Option + Space, and leave its experimental automatic Enter off. Use
the helper's **Pair Omni on this Mac** menu to pair each Omni address/browser.
Dictation goes into a review box; **Insert into draft** does not send a message.
Stop Wispr using its Flow Bar before closing the review box.

The helper only accepts authenticated requests on 127.0.0.1:43821 from explicitly
paired origins. It emits one fixed shortcut only while the labelled dictation
field is focused. It does not read audio, transcripts, or clipboard contents.
It cannot observe whether Wispr is recording: check the Flow Bar before retrying
an uncertain start/stop request. Text already received is retained locally per chat.

Build a portable Intel/Apple Silicon installer with `npm run package:mac` on a Mac.
It produces `public/downloads/omni-dictation-macos.zip`, served by Omni's download
endpoint. Include that artifact when deploying to Linux/VPS; Linux cannot build
the native helper. A new HTTPS Omni address needs pairing again. Browsers may
ask for local-network access; do not disable browser security protections.

This local build is ad-hoc signed. Public distribution requires a Developer ID
signature and notarization (set `OMNI_MAC_SIGN_IDENTITY` for the signing step).
Never bypass a Gatekeeper warning to install an unverified download.
