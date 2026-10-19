import type { Metadata } from "next";
import { DiscoverView } from "@/components/views/discover-view";

export const metadata: Metadata = {
  title: "Made for you",
  description: "Mood shelves and artist radio, seeded from your listening.",
};

export default function Page() {
  return <DiscoverView />;
}
