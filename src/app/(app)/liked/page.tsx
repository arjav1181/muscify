import type { Metadata } from "next";
import { LikedSongsView } from "@/components/views/liked-view";

export const metadata: Metadata = {
  title: "Liked Songs",
  description: "Every song you've saved, in one place.",
};

export default function Page() {
  return <LikedSongsView />;
}