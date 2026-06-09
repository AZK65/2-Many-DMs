import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OmniCRM — Unified Inbox",
  description: "One inbox for X, WhatsApp, and Telegram with built-in CRM tags.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
