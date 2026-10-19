import type { Metadata } from "next";
import { PodcastsView } from "@/components/views/podcasts-view";

export const metadata: Metadata = {
  title: "Podcasts",
  description: "Find podcast shows and episodes wherever they publish on YouTube.",
};

export default function Page() {
  return <PodcastsView />;
}