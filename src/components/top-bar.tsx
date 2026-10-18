"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, ShieldHalf, X } from "lucide-react";
import { resolveMusicUrl } from "@/lib/api-client";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";
import { useLibrary } from "@/store/library-store";

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
  const noteSearch = useLibrary((s) => s.noteSearch);
  const [historyOpen, setHistoryOpen] = useState(false);

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

    noteSearch(q);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <header className="flex h-16 items-center gap-3 px-4">
      <form
        role="search"
        className="relative w-full max-w-[420px]"
        onFocus={() => setHistoryOpen(true)}
        onBlur={() => setHistoryOpen(false)}
        onSubmit={(e) => {
          e.preventDefault();
          submit(query);
          setHistoryOpen(false);
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

        {historyOpen && !query ? <SearchHistory onPick={submit} /> : null}
      </form>

      <PrivateSessionToggle />
    </header>
  );
}

/**
 * Private Session.
 *
 * Lives in the top bar rather than a settings page because it is meant to be
 * flipped *before* listening, in the same motion as pressing play — burying it
 * would make it something nobody ever turns on.
 *
 * It stops plays being counted in stats and taste weighting. It does not hide
 * them from recently-played: this is not a private mode, it is a taste
 * control, and conflating the two would misrepresent what it does.
 */
function PrivateSessionToggle() {
  const active = useLibrary((s) => s.settings.privateSession);
  const updateSettings = useLibrary((s) => s.updateSettings);
  const toast = useUi((s) => s.toast);

  return (
    <button
      type="button"
      onClick={() => {
        const next = !active;
        updateSettings({ privateSession: next });
        toast(
          next
            ? "Private Session on — new listens won't affect stats or recommendations"
            : "Private Session off",
          "success",
        );
      }}
      aria-pressed={active}
      title={
        active
          ? "Private Session is on. New listens are excluded from stats and recommendations."
          : "Turn on Private Session to keep this listening out of your stats"
      }
      className={`ml-3 flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-green-400/60 bg-green-400/15 text-green-300"
          : "border-line-strong text-dim hover:text-on"
      }`}
    >
      <ShieldHalf size={14} aria-hidden />
      <span className="hidden sm:inline">Private</span>
    </button>
  );
}

/**
 * Recent searches.
 *
 * Local only, capped, and deduped by query in the store — a repeat search
 * bumps its entry rather than stacking a duplicate. Clicking one re-runs it.
 */
function SearchHistory({ onPick }: { onPick: (value: string) => void }) {
  const history = useLibrary((s) => s.searchHistory);
  const clear = useLibrary((s) => s.clearSearchHistory);

  if (history.length === 0) return null;

  return (
    <div className="absolute top-full left-0 z-40 mt-2 w-full overflow-hidden rounded-lg border border-line-strong bg-base shadow-xl">
      <ul className="max-h-72 overflow-y-auto py-1">
        {history.map((entry) => (
          <li key={entry.query}>
            <button
              type="button"
              onMouseDown={(e) => {
                // mousedown fires before blur, so the click is not lost.
                e.preventDefault();
                onPick(entry.query);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5"
            >
              <Search size={13} className="shrink-0 text-dim" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{entry.query}</span>
              {entry.count > 1 ? (
                <span className="shrink-0 text-[10px] text-dim">{entry.count}×</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          clear();
        }}
        className="w-full border-t border-line px-3 py-2 text-left text-xs text-dim hover:text-on hover:bg-white/5"
      >
        Clear search history
      </button>
    </div>
  );
}
