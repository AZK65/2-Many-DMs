import type { Metadata } from "next";
import "./globals.css";
import { SupportBubble } from "@/components/SupportBubble";

export const metadata: Metadata = {
  title: "Unified Inbox",
  description: "One inbox for X, WhatsApp, and Telegram with built-in CRM tags.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {children}
        {/* App-wide support bubble — remove this line to take it off every page. */}
        <SupportBubble />
      </body>
    </html>
  );
}
