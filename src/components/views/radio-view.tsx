"use client";

import { useState } from "react";
import { Radio as RadioIcon, Search, Wifi, X } from "lucide-react";
import { artFallback } from "@/lib/art";
import type { Track } from "@/lib/types";
import { usePlayer } from "@/store/player-store";
import { useResource } from "@/hooks/use-resource";
import { useTrackMenu } from "@/components/track-menu";
import { useDebounced } from "@/hooks/use-debounced";

function StationCard({ track }: { track: Track }) {
  const playTracks = usePlayer((s) => s.playTracks);
  const queue = usePlayer((s) => s.queue);
  const currentIndex = usePlayer((s) => s.index);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const toggle = usePlayer((s) => s.toggle);
  const trackMenu = useTrackMenu();

  const isCurrent =
    queue[currentIndex]?.source === "radio" && queue[currentIndex]?.id === track.id;

  return (
    <button
      type="button"
      onClick={() =>
        isCurrent ? toggle() : playTracks([track], 0, { kind: "station", id: track.id })
      }
      onContextMenu={(e) => trackMenu(e, track)}
      className="group flex items-center gap-4 rounded-lg bg-surface p-3 text-left transition-colors hover:bg-highlight"
    >
      <div
        className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded"
        style={{ background: artFallback(track) }}
      >
        {track.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <RadioIcon size={20} className="text-white/40" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${isCurrent ? "text-spotify" : "text-on"}`}>
          {track.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-sub">
          {isCurrent && isPlaying ? (
            <span className="inline-flex items-center gap-1 text-spotify">
              <Wifi size={11} /> ON AIR
            </span>
          ) : (
            track.artist
          )}
        </p>
      </div>
    </button>
  );
}

/**
 * Radio directory.
 *
 * The full station list loads once; filtering then hits the stations endpoint,
 * which does tag/genre matching ("jazz radio" → Sonic Universe) rather than a
 * naive substring test.
 */
export function RadioView() {
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebounced(filter, 250);

  const directory = useResource("directory", async (signal) => {
    const res = await fetch("/api/music/browse?kind=radio", { signal });
    const json = (await res.json()) as { results?: Track[] };
    return json.results ?? [];
  });

  const matches = useResource(
    debouncedFilter.trim() ? `q:${debouncedFilter.trim()}` : null,
    async (signal) => {
      const res = await fetch(
        `/api/music/stations?${new URLSearchParams({ q: debouncedFilter.trim() })}`,
        { signal },
      );
      const json = (await res.json()) as { results?: Track[] };
      return json.results ?? [];
    },
  );

  const searching = debouncedFilter.trim().length > 0;
  const list = searching ? (matches.data ?? []) : (directory.data ?? []);
  const busy = searching ? matches.loading : directory.loading;

  return (
    <div className="animate-fade-up pt-6">
      <h2 className="text-2xl font-bold tracking-tight text-on">Radio</h2>
      <p className="mt-1 mb-5 text-sm text-sub">
        Live, always-on streams from SomaFM. Radio never ends — it just rolls into the next
        station.
      </p>

      <div className="relative mb-6">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim"
        />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search stations or genres — try “jazz radio”"
          aria-label="Search radio stations"
          className="w-full max-w-md rounded-full border border-transparent bg-highlight py-2 pr-9 pl-9 text-sm text-on placeholder:text-dim focus:border-line-strong focus:outline-none"
        />
        {filter ? (
          <button
            type="button"
            onClick={() => setFilter("")}
            aria-label="Clear"
            className="absolute top-1/2 right-3 -translate-y-1/2 text-dim hover:text-on"
          >
            <X size={15} />
          </button>
        ) : null}
      </div>

      {busy && !list.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-4 rounded-lg bg-surface p-3">
              <div className="h-14 w-14 rounded bg-highlight" />
              <div className="flex-1">
                <div className="mb-2 h-3 w-2/3 rounded bg-highlight" />
                <div className="h-3 w-1/3 rounded bg-highlight" />
              </div>
            </div>
          ))}
        </div>
      ) : list.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((track) => (
            <StationCard key={track.id} track={track} />
          ))}
        </div>
      ) : searching ? (
        <p className="py-10 text-sm text-dim">No stations match “{filter.trim()}”.</p>
      ) : (
        <p className="py-10 text-sm text-dim">No stations available right now.</p>
      )}
    </div>
  );
}