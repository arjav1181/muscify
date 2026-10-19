import type { Metadata, Viewport } from "next";
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

/**
 * The document shell, and nothing else.
 *
 * AppShell used to live here, which meant every route inherited the sidebar,
 * the top bar and the player bar -- including the landing page, which needs none
 * of them. It now lives in the `(app)` route group, so a page is inside the
 * player because it is part of the player, rather than because of where it
 * happens to sit in the tree.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}