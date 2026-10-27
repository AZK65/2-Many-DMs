import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { WorkspaceMotion } from "@/components/WorkspaceMotion";
import "./globals.css";

export const metadata: Metadata = {
  title: "2 Many DMs",
  description:
    "One inbox for X, WhatsApp, Telegram, and Discord with built-in CRM tags.",
  // Safari's "Add to Dock" reads these: standalone window, no browser chrome.
  appleWebApp: {
    capable: true,
    title: "2 Many DMs",
    statusBarStyle: "black-translucent",
  },
};

// Next 14 wants themeColor here rather than in `metadata`. Two entries so the
// window chrome follows the system theme, matching the app's light/true-black.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
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
      <body className={GeistSans.variable}>
        <WorkspaceMotion>{children}</WorkspaceMotion>
        {/* App-wide support bubble — remove this line to take it off every page. */}
      </body>
    </html>
  );
}
