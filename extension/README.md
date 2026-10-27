# 2 Many DMs — Connect X

Pair your own signed-in X browser session with your private 2manydms server.
The connector does not send your session until you submit its form.

## Guided setup

1. Open **Connect X** in 2manydms and download/unzip this connector.
2. Open `chrome://extensions` (Edge: `edge://extensions`), enable **Developer mode**,
   choose **Load unpacked**, and select the folder containing `manifest.json`.
3. Sign in to **x.com** in that same browser profile. Private windows use a separate session.
4. In 2manydms, choose **Connector installed. Continue**.
5. Open the extension and paste the exact **App URL** and **Pairing code** shown by setup.
6. Choose **Connect my X account** and allow access to that app address.
7. Return to setup to check live sync. If prompted, enter your existing numeric X Chat passcode
   in the app. Do not enter your X password.

The code expires after ten minutes. Saving a session does not prove sync is live or all history
has loaded. The app verifies live connection status separately.

## Recovery

- **Code expired:** create a new code in the app.
- **No X session:** sign in on x.com in this browser, then retry.
- **Cannot reach app / Invite required:** use the exact private owner App URL. On a VPS, use a
  private owner connection such as a localhost SSH tunnel. Marketing and read-only guest views
  intentionally reject account connections.
- **Timed out after submitting:** check the app first. Retrying a completed code during its
  validity returns the same account instead of creating another.
- **Locked chats:** recover a forgotten passcode in X first; the connector cannot bypass it.

## Security

- Only the explicitly chosen server receives the `auth_token` and `ct0` cookie pair.
- HTTPS is required except for localhost/127.0.0.1. Redirects are rejected.
- Host access is requested only for the selected app host. No manifest editing is necessary.
- Only the App URL is remembered by the extension. Codes and sessions are not saved in extension
  storage. The server encrypts account sessions using `APP_ENCRYPTION_KEY`.
- Set a private, persistent encryption key before using real accounts. Keep the server owner-only;
  pairing codes are not a substitute for server access controls.
- This is a browser-session connector, not an official X DM integration. Provider limits,
  authentication challenges and account policies still apply.
