import { Suspense } from "react";
import type { Metadata } from "next";
import { AlbumView } from "@/components/views/album-view";

export const metadata: Metadata = {
  title: "Album",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="pt-6 text-sm text-sub">Loading album…</div>}>
      <AlbumView id={id} />
    </Suspense>
  );
}