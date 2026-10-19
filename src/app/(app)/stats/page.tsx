import { StatsView } from "@/components/views/stats-view";

export const metadata = {
  // The layout template already appends the app name.
  title: "Listening stats",
  description: "Your listening history, computed locally from your play log.",
};

export default function StatsPage() {
  return <StatsView />;
}
