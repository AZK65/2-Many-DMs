import type { MetadataRoute } from "next";

// Makes the app installable as a standalone dock app: Safari → File → Add to
// Dock (or Chrome → Install). It opens in its own window with no browser
// chrome, still talking to whichever host is serving it — localhost in dev, the
// Tailscale hostname of the self-hosted box in normal use.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "2 Many DMs",
    short_name: "2 Many DMs",
    description:
      "One inbox for X, WhatsApp, Telegram, and Discord with built-in CRM tags.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
