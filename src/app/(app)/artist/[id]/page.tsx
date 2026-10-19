import { Suspense } from "react";
import type { Metadata } from "next";
import { ArtistView } from "@/components/views/artist-view";

export const metadata: Metadata = {
  title: "Artist",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="pt-6 text-sm text-sub">Loading artist…</div>}>
      <ArtistView id={id} />
    </Suspense>
  );
}