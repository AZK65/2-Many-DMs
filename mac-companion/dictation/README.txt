Omni Dictation for Mac (macOS 13+)

1. Run Install.command beside Omni Dictation.app. The helper starts at login.
2. Install Wispr Flow from https://wisprflow.ai/downloads, sign in and complete setup.
3. Open Omni Dictation's menu-bar mic -> Accessibility permission. Grant it manually.
4. In Wispr Settings -> General -> Shortcuts, add Control + Option + Space to
   hands-free dictation. Keep the experimental Press Enter command off.
5. In Omni's chat composer, click the mic. Open the helper menu -> Pair Omni
   on this Mac. Enter the six-digit code in Omni. It expires in five minutes.

The helper only sends the configured shortcut while the labelled Omni dictation
text field is focused. It does not know whether Wispr actually started: look at
the Flow Bar. Stop Wispr before inserting text or closing the draft. A shortcut
timeout is not retried automatically, because another toggle could restart it.

Only the paired web origin may invoke it. Each new VPS domain/browser must pair
again. The helper listens on 127.0.0.1:43821, never the LAN. Do not expose this
port through a reverse proxy. Browser local-network permission may be required.
If a browser blocks loopback access, use Wispr's normal keyboard shortcut;
do not disable mixed-content, CORS or other browser security protections.

The helper reads no audio or clipboard text, saves no transcripts, and makes no
requests to Wispr's servers. Wispr handles microphone capture, transcription,
privacy settings and billing. Omni retains the text draft in your browser until
you insert it. Nothing is automatically sent to a chat.

This package includes Omni's helper, not Wispr itself. Locally built copies are
ad-hoc signed. For public distribution, sign with an Apple Developer ID and
notarize the package; do not instruct users to bypass macOS security warnings.

To revoke access, helper menu -> Forget paired Omni sites.
To stop launch at login, remove Omni Dictation in macOS Login Items or unload
the com.2manydms.omnidictation LaunchAgent, then quit the helper.
