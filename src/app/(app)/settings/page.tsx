import { SettingsView } from "@/components/views/settings-view";

export const metadata = {
  title: "Settings",
  description: "Playback, privacy, lyrics and your local library data.",
};

export default function SettingsPage() {
  return <SettingsView />;
}
