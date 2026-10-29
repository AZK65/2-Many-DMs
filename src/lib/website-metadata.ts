import type { Metadata } from "next";

export function websiteMetadata(title = "2 Many DMs — Your people. Not your tabs.", description = "An independent workspace for Telegram, WhatsApp, X, and Discord search. Find conversations, keep context, and connect an optional chat assistant.", path = "/"): Metadata {
  return {
    title, description,
    alternates: { canonical: `https://2manydms.com${path}` },
    openGraph: { title, description, type: "website", url: `https://2manydms.com${path}`, siteName: "2 Many DMs", images: [{ url: "https://2manydms.com/brand/lockup-dark.png", alt: "2 Many DMs" }] },
    twitter: { card: "summary", title, description, images: ["https://2manydms.com/brand/lockup-dark.png"] },
  };
}
