import type { Metadata } from "next";
import { RadioView } from "@/components/views/radio-view";

export const metadata: Metadata = {
  title: "Radio",
  description: "Live, always-on streams from SomaFM.",
};

export default function Page() {
  return <RadioView />;
}