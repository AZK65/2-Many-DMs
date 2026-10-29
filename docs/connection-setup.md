# Connect your messaging accounts

Open **Settings → Connections → Connect account**, or use the welcome screen. Each setup can be closed and resumed. “Account saved” is not “Connected”: the app waits for the sync service to confirm the account is ready. Older history can still be importing after the live connection is ready.

## Telegram

1. Have Telegram signed in on your phone.
2. If prompted for app credentials, open [Telegram API development tools](https://my.telegram.org/apps). Sign in with that same phone number. The website login code arrives in Telegram.
3. Open **API development tools**. Reuse an existing app if one is shown. Otherwise enter an app title, a short name, choose **Desktop**, describe your personal messaging client, and create the application.
4. Copy **App api_id** and **App api_hash** into setup. These are not a bot token. Keep the hash private.
5. Enter your phone number with **+ and country code**. Enter the newest code from Telegram. If asked, enter your Telegram two-step verification password, not your phone unlock code.
6. Wait for the live connection check. App credentials and the saved session are encrypted on your server.

Bad codes can be corrected without restarting. Resends are paced; an expired login has a clear restart option. Telegram flood-wait deadlines are respected, even when longer than a day. If Telegram's own app-creation website refuses the request, resolve it there; this app cannot override their restrictions. [Official Telegram instructions](https://core.telegram.org/api/obtaining_api_id).

## WhatsApp

1. Keep your phone online and open this setup on another screen.
2. Choose **Show my QR code**.
3. On iPhone: **WhatsApp → Settings → Linked devices → Link a device**. On Android: **WhatsApp → ⋮ → Linked devices → Link a device**.
4. Scan with WhatsApp's scanner, not your camera app. Wait for the app to show the live connection.
5. If a code will not scan, choose **Generate new QR code**. Codes also rotate automatically while linking.

This adds a companion device; it does not move or delete phone chats. If the linked-device list is full, remove a device you no longer use. If WhatsApp revokes the login, another scan is required. Never reset your phone account to repair this connection. [Official device-linking guide](https://faq.whatsapp.com/1317564962315842).

## X

1. Use Chrome or Edge on your computer. Download and unzip the connector from setup.
2. Open **chrome://extensions** or **edge://extensions**, enable **Developer mode**, select **Load unpacked**, and choose the unzipped connector folder.
3. Sign in at **x.com** in a normal tab, completing any security checks there.
4. In this app choose **Connector installed. Continue**.
5. Open **2 Many DMs — Connect X** from the extensions menu. Paste the exact **App URL** and **Pairing code** shown by setup, then select **Connect my X account**.
6. Return to setup. It detects the saved account automatically. If encrypted chats are locked, enter your existing **X Chat passcode**, not your X account password. Recover forgotten passcodes in X itself.

Pairing codes expire and can be regenerated. The connector sends the session only to the address you enter; keep that address private and verify it. This is an unofficial browser-based connection, not an official X DM API integration. Provider limits, security checks, and history availability still apply.

## Discord private search

1. Use the app on the computer running sync, with a desktop session and Google Chrome installed.
2. Select **Open Discord sign-in**. A separate Chrome window opens on that computer.
3. Sign in normally, or use **Discord mobile → You → Settings → Scan QR Code** and approve the login you just started. Complete Discord's security checks there.
4. The window closes when the session is saved. Setup checks the live connection separately.
5. Search in your inbox with the **Discord** filter. Open results in Discord to reply.

Personal DMs and group DMs sync live; the default last 90 days are indexed gradually. Server channels are not indexed by this connection. It is read-only: no sends, reactions, acknowledgements, or automated replies. The personal-account connection is unofficial and can carry account restrictions. Official bot connections remain separate. An existing Discord desktop-app login is not automatically imported. Do not copy tokens or share QR codes. [Official Discord QR guidance](https://support.discord.com/hc/en-us/articles/360039213771-QR-Code-Login-FAQ).

Discord sign-in currently cannot be completed from a remote browser on a headless VPS. Setup explains this instead of pretending a window opened on the visitor's device.

## Why some steps open outside the app

WhatsApp's QR and Telegram's phone/code/password fields work directly in the app; they do not need an iframe. Telegram's app-creation site and X's login only allow framing by their own origins. Discord's login denies framing. Their security headers were checked on October 29, 2026. We do not remove those protections or proxy login pages.

## Hosting and safe upgrades

Keep the database, platform session folders, local Discord search key, and APP_ENCRYPTION_KEY persistent. Do not change an existing encryption key during upgrades. Serve setup through a private owner-only connection; same-origin checks are not a replacement for authentication. A stopped worker requires **Start sync**, not a new login. No provider can promise zero outages or unrestricted history.

## Verification

Run the focused connection tests with Node's test runner. For browser checks, start a local dev server and run:

```sh
ONBOARDING_TEST_URL=http://127.0.0.1:3002 node scripts/verify-onboarding.mjs
```

The browser check intercepts all API calls with fixtures. It does not request real codes, connect devices, or modify saved accounts. Screenshots are saved under the ignored .local/onboarding-qa directory. Chrome must be installed.
