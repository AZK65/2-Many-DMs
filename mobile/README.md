# Omni CRM for iOS

The iOS app is a React Native client for the existing self-hosted Omni CRM backend. The SQLite database, login sessions, media, browser workers, and sync connectors remain on the Mac or home server. The phone reaches that machine through a private Tailscale Serve HTTPS address.

## Architecture

```text
iPhone / TestFlight app
        │ HTTPS inside the tailnet
        ▼
Tailscale Serve on the private host
        │ localhost:3000
        ▼
Existing Next.js API + Prisma/SQLite + sync worker
```

The app includes an on-device cache for recent conversations and messages. That cache is a convenience copy, not a second backend. The private server remains the source of truth.

## Connect the private backend

1. Install Tailscale on the Omni host and the iPhone, then sign both into the same tailnet.
2. Build and start Omni on the host:

   ```bash
   npm install
   npm run build
   npm run start:private
   ```

3. In another terminal on the host, expose port 3000 only to the tailnet:

   ```bash
   npm run mobile:serve
   ```

   On macOS, the script finds both the command-line integration and the CLI bundled in `/Applications/Tailscale.app`. On other platforms, `tailscale` must be available on the command path. Set `OMNI_TAILSCALE_CLI` only when the executable lives elsewhere.

4. Tailscale prints an address similar to `https://omni-host.example-tailnet.ts.net`. Enter that address on the iOS connection screen.

Use Tailscale Serve, not Funnel. Serve keeps the app private and applies the tailnet access policy. The Next server listens on localhost so clients cannot spoof Tailscale identity headers over the LAN.

## Local iOS development

The project uses Expo SDK 57 and React Native 0.86.

```bash
cd mobile
npm install
npm run ios
```

The bundled preview mode works without a server and contains only fake sample data. It is also the review path for testers who cannot access the private tailnet.

## TestFlight

Requirements:

- Apple Developer Program membership
- An App Store Connect team with permission to create apps and builds
- An Expo account for EAS Build, or a local Xcode archive workflow
- A unique `ios.bundleIdentifier` in `app.json`

For EAS, authenticate and create the first TestFlight build:

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest build --platform ios --auto-submit
```

EAS will prompt for the Apple team and signing credentials, create the App Store Connect record if needed, build the `.ipa`, and submit it to TestFlight. For App Review notes, explain that production data is available only through the customer's Tailscale network and direct the reviewer to **Preview with sample data**.

Before a public release, replace the placeholder bundle identifier if necessary and provide App Store screenshots, privacy policy/support URLs, and review contact details in App Store Connect.
