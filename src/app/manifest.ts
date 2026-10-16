import type { MetadataRoute } from "next";

/**
 * Installable web-app manifest.
 *
 * `display: standalone` plus the maskable icon is what makes "Add to Home
 * Screen" launch the app full-screen rather than in a browser chrome. The
 * shortcuts mirror the app's own navigation so long-press on the icon gives
 * direct access to Search and Radio.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "muscify",
    short_name: "muscify",
    description:
      "A music player for YouTube, Deezer, SomaFM radio and SoundCloud links.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#121212",
    categories: ["music", "entertainment"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Search", url: "/search", description: "Find music" },
      { name: "Radio", url: "/radio", description: "Live SomaFM streams" },
      { name: "Liked Songs", url: "/liked", description: "Everything you saved" },
    ],
  };
}