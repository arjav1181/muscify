import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import { LibraryHydrator } from "@/components/library-hydrator";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "muscify",
    template: "%s · muscify",
  },
  description:
    "A music player for YouTube, Deezer, SomaFM radio and SoundCloud links, with a Spotify-shaped interface.",
  applicationName: "muscify",
  formatDetection: { telephone: false },
  /**
   * SomaFM's Ice servers reject any audio request carrying a `Referer` header
   * — 403, no stream. Browsers send one for media requests by default, so
   * without this every radio station silently fails for real users.
   *
   * This must be a document-level policy: a per-element `referrerpolicy`
   * attribute is not honoured for media element requests. Verified against the
   * same stream: 200 with this set, 403 without.
   */
  referrer: "no-referrer",
  // iOS standalone mode; theme colour belongs on `viewport` instead.
  appleWebApp: {
    capable: true,
    title: "muscify",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#121212",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LibraryHydrator />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}