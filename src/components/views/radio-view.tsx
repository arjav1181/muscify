"use client";

import { useState } from "react";
import { Radio as RadioIcon, Search, Wifi, X } from "lucide-react";
import { artFallback } from "@/lib/art";
import type { RadioRegion, Track } from "@/lib/types";
import { usePlayer } from "@/store/player-store";
import { useResource } from "@/hooks/use-resource";
import { useDebounced } from "@/hooks/use-debounced";
import { useTrackMenu } from "@/components/track-menu";

type Region = RadioRegion | "all";

const REGIONS: { id: Region; label: string }[] = [
  { id: "all", label: "All" },
  { id: "india", label: "Indian" },
  { id: "international", label: "International" },
];

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
          <RadioIcon size={20} className="text-muted" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${isCurrent ? "text-spotify" : "text-on"}`}>
          {track.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-sub">
          {isCurrent && isPlaying ? (
            <span className="inline-flex items-center gap-1 text-spotify">
              <Wifi size={11} /> ON AIR
            </span>
          ) : (
            <>
              <span className="truncate">{track.artist}</span>
              {track.language ? (
                <>
                  <span className="text-dim">·</span>
                  <span className="shrink-0 uppercase">{track.language}</span>
                </>
              ) : null}
            </>
          )}
        </p>
      </div>
    </button>
  );
}

function Skeleton() {
  return (
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
  );
}

/**
 * Radio directory.
 *
 * Two sources are merged server-side: SomaFM (a curated US selection) and the
 * Radio Browser directory (which carries the Indian listings). The region chips
 * scope the list; searching hits the stations endpoint, which matches on names,
 * genre tags and language.
 */
export function RadioView() {
  const [region, setRegion] = useState<Region>("all");
  const [filter, setFilter] = useState("");
  const debounced = useDebounced(filter, 250);
  const q = debounced.trim();
  const searching = q.length > 0;

  const regionKey = region === "all" ? null : region;

  const directory = useResource(
    searching ? null : `dir:${regionKey ?? "all"}`,
    async (signal) => {
      const query = new URLSearchParams({ kind: "radio" });
      if (regionKey) query.set("region", regionKey);
      const res = await fetch(`/api/music/browse?${query}`, { signal });
      const json = (await res.json()) as { results?: Track[] };
      return json.results ?? [];
    },
  );

  const matches = useResource(
    searching ? `q:${q}:${regionKey ?? "all"}` : null,
    async (signal) => {
      const query = new URLSearchParams({ q });
      if (regionKey) query.set("region", regionKey);
      const res = await fetch(`/api/music/stations?${query}`, { signal });
      const json = (await res.json()) as { results?: Track[] };
      return json.results ?? [];
    },
  );

  const list = searching ? (matches.data ?? []) : (directory.data ?? []);
  const busy = searching ? matches.loading : directory.loading;

  return (
    <div className="animate-fade-up pt-6">
      <h2 className="text-2xl font-bold tracking-tight text-on">Radio</h2>
      <p className="mt-1 mb-5 text-sm text-sub">
        Live, always-on streams. Radio never ends — it just rolls into the next station.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {REGIONS.map((r) => (
          <button
            key={r.id}
            onClick={() => setRegion(r.id)}
            aria-pressed={region === r.id}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              region === r.id
                ? "border-on bg-on text-black"
                : "border-line-strong text-sub hover:border-on hover:text-on"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="relative mb-6">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim"
        />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search stations or genres — try “bollywood radio” or “tamil”"
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
        <Skeleton />
      ) : list.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((track) => (
            <StationCard key={track.id} track={track} />
          ))}
        </div>
      ) : searching ? (
        <p className="py-10 text-sm text-dim">No stations match “{q.trim()}”.</p>
      ) : (
        <p className="py-10 text-sm text-dim">No stations available right now.</p>
      )}
    </div>
  );
}