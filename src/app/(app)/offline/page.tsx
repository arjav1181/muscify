import Link from "next/link";
import { CloudOff } from "lucide-react";

export const metadata = {
  title: "Offline",
  description: "You are offline. Your saved music is still here.",
};

/**
 * Served by the service worker when a navigation fails with no network.
 *
 * A plain static page on purpose. It must not fetch anything, or it will fail
 * in exactly the situation it exists for. The copy is deliberately short: the
 * person reading it is on a train with no signal and does not need a paragraph.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-full bg-highlight text-sub"
      >
        <CloudOff size={28} />
      </span>
      <div className="space-y-2">
        <h1 className="text-title font-bold tracking-tight text-on">You are offline</h1>
        <p className="max-w-sm text-body text-sub">
          Your playlists, liked songs and history are still on this device. Reconnect to search
          and stream.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-full bg-on px-5 py-2.5 text-label font-bold text-black transition hover:scale-[1.02]"
      >
        Go to your library
      </Link>
    </main>
  );
}