import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchView } from "@/components/views/search-view";

export const metadata: Metadata = {
  title: "Search",
  description: "Search songs, videos, artists, albums, playlists and radio stations.",
};

export default function Page() {
  return (
    <Suspense fallback={<div className="pt-6 text-sm text-sub">Loading search…</div>}>
      <SearchView />
    </Suspense>
  );
}