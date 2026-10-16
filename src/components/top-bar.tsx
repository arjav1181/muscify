"use client";

import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { resolveMusicUrl } from "@/lib/api-client";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";

/**
 * Sticky header carrying the global search field.
 *
 * Query state lives in the ui-store so the field and the results pane never
 * disagree, and typing doesn't re-render the route.
 */
export function TopBar() {
  const router = useRouter();
  const query = useUi((s) => s.query);
  const setQuery = useUi((s) => s.setQuery);

  const submit = (value: string) => {
    const q = value.trim();
    if (!q) return;

    // A pasted link is played directly — it needs no search, and this path
    // works even with no API key configured.
    if (/^https?:\/\//i.test(q)) {
      void (async () => {
        const toast = useUi.getState().toast;
        try {
          const track = await resolveMusicUrl(q);
          usePlayer.getState().playTracks([track], 0, { kind: "link", id: q });
          toast(`Playing ${track.title}`, "success");
        } catch (e) {
          toast(e instanceof Error ? e.message : "Could not play that link", "error");
        }
      })();
      setQuery("");
      return;
    }

    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 bg-surface/90 px-4 py-3 backdrop-blur-md">
      <form
        role="search"
        className="relative w-full max-w-[420px]"
        onSubmit={(e) => {
          e.preventDefault();
          submit(query);
        }}
      >
        <Search
          size={18}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim"
        />
        <input
          id="muscify-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What do you want to listen to?"
          aria-label="Search songs, artists, or paste a link"
          className="w-full rounded-full border border-transparent bg-highlight py-2.5 pr-10 pl-10 text-sm text-on placeholder:text-dim focus:border-line-strong focus:outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-3 -translate-y-1/2 text-dim hover:text-on"
          >
            <X size={16} />
          </button>
        ) : null}
      </form>
    </header>
  );
}