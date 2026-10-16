"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Play } from "lucide-react";
import type { Track } from "@/lib/types";
import { TrackCard as DefaultTrackCard } from "@/components/track-card";

interface ShelfProps {
  title: string;
  subtitle?: string;
  tracks: Track[];
  loading?: boolean;
  errors?: string[];
  emptyLabel?: string;
  /** Rendered as a "Play all" button in the header. */
  onPlayAll?: () => void;
  /** Override the card renderer, e.g. to pass the full list for context. */
  renderCard?: (track: Track, index: number) => ReactNode;
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="mb-4 aspect-square rounded bg-highlight" />
          <div className="mb-2 h-3 w-4/5 rounded bg-highlight" />
          <div className="h-3 w-3/5 rounded bg-highlight" />
        </div>
      ))}
    </div>
  );
}

export function Shelf({
  title,
  subtitle,
  tracks,
  loading,
  errors,
  emptyLabel,
  onPlayAll,
  renderCard,
}: ShelfProps) {
  // Hide a shelf with nothing and no explanation, so one dead provider doesn't
  // leave a permanent empty section in the layout.
  if (!loading && tracks.length === 0 && !(errors && errors.length)) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-on">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-sub">{subtitle}</p> : null}
        </div>
        {onPlayAll && tracks.length ? (
          <button
            type="button"
            onClick={onPlayAll}
            title={`Play all in ${title}`}
            aria-label={`Play all in ${title}`}
            className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-spotify text-black shadow-lg transition hover:scale-105 sm:flex"
          >
            <Play size={16} fill="currentColor" className="translate-x-[1px]" />
          </button>
        ) : null}
      </div>

      {errors && errors.length ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-spotify/30 bg-spotify/10 px-3 py-2 text-xs text-spotify">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>{errors.join(" · ")}</span>
        </div>
      ) : null}

      {loading ? (
        <Skeleton />
      ) : tracks.length === 0 ? (
        <p className="py-4 text-sm text-dim">{emptyLabel ?? "Nothing here right now."}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {tracks.map((track, i) =>
            renderCard ? (
              <span key={`${track.source}:${track.id}:${i}`}>{renderCard(track, i)}</span>
            ) : (
              <DefaultTrackCard key={`${track.source}:${track.id}:${i}`} track={track} index={i} />
            ),
          )}
        </div>
      )}
    </section>
  );
}