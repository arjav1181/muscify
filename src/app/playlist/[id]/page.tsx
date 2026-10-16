import { Suspense } from "react";
import type { Metadata } from "next";
import { PlaylistView } from "@/components/views/playlist-view";

export const metadata: Metadata = {
  title: "Playlist",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="pt-6 text-sm text-sub">Loading playlist…</div>}>
      <PlaylistView id={id} />
    </Suspense>
  );
}