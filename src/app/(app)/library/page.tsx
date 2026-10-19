import type { Metadata } from "next";
import { LibraryView } from "@/components/views/library-view";

export const metadata: Metadata = {
  title: "Your Library",
  description: "Your playlists, liked songs, artists, albums and listening history.",
};

export default function Page() {
  return <LibraryView />;
}