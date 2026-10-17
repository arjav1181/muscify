import { StatsView } from "@/components/views/stats-view";

export const metadata = {
  title: "Listening stats · muscify",
  description: "Your listening history, computed locally from your play log.",
};

export default function StatsPage() {
  return <StatsView />;
}
