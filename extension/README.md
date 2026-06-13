# OmniCRM — Connect X (Chrome extension, Manifest V3)

Hands your existing X (Twitter) session to your OmniCRM inbox so it can sync
your DMs — no copy-pasting cookies by hand.

## How it works
1. The app's onboarding screen shows a **one-time pairing code**.
2. You open this extension, paste the code, and click **Connect**.
3. The extension reads your `auth_token` and `ct0` cookies from `x.com`
   (via the `cookies` permission — it can read httpOnly cookies) and POSTs them
   to your app at `/api/accounts/x/connect`.
4. The app verifies the code, encrypts the cookies (AES-256-GCM), and stores
   them on your X account.

## Install (unpacked, for development)
1. Go to `chrome://extensions`.
2. Toggle **Developer mode** (top-right) on.
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the extension. Make sure you're logged into **x.com** in this browser.
5. In the app's onboarding (or `/welcome`), open the **X** card to get a code,
   then paste it into the extension and hit **Connect**.

## Security notes (for production)
- The connect endpoint is gated by the **one-time pairing code** (10-min TTL),
  so it isn't an open cookie sink. Lock CORS to your extension's origin and
  serve the app over HTTPS before going live.
- Set `APP_ENCRYPTION_KEY` (32 bytes) on the server — cookies are encrypted at
  rest with it.
- Update `host_permissions` in `manifest.json` to your production app domain.
