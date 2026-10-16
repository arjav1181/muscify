"use client";

import { useRef, useState } from "react";
import { Heart, ImageOff, ListPlus, Music2 } from "lucide-react";
import { artFallback } from "@/lib/art";
import { trackKey, type Track } from "@/lib/types";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";
import { Equalizer } from "@/components/equalizer";

interface TrackRowProps {
  track: Track;
  index: number;
  /** Queue position, when rendered inside the queue panel. */
  onPlay?: () => void;
  onRemove?: () => void;
  onAddToPlaylist?: () => void;
  showArtwork?: boolean;
  showDuration?: boolean;
  /** Extra controls revealed on hover, appended after the title block. */
  actions?: React.ReactNode;
  active?: boolean;
  onContextMenu?: (e: React.MouseEvent, track: Track) => void;
}

export function TrackRow({
  track,
  index,
  onPlay,
  onRemove,
  onAddToPlaylist,
  showArtwork = true,
  showDuration = false,
  actions,
  active,
  onContextMenu,
}: TrackRowProps) {
  const currentIndex = usePlayer((s) => s.index);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const jump = usePlayer((s) => s.jump);
  const enqueueNext = usePlayer((s) => s.enqueueNext);

  const key = trackKey(track);
  const liked = useLibrary((s) => s.liked.some((l) => l.key === key));
  const toggleLike = useLibrary((s) => s.toggleLike);
  const toast = useUi((s) => s.toast);

  const isCurrent = (active ?? currentIndex === index) && isPlaying;
  const play = onPlay ?? (() => jump(index));

  const duration =
    track.duration && track.duration > 0
      ? formatDuration(track.duration)
      : track.source === "radio"
        ? "LIVE"
        : "—";

  return (
    <div
      role="row"
      tabIndex={-1}
      onContextMenu={(e) => onContextMenu?.(e, track)}
      className={`group grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 transition-colors sm:grid-cols-[16px_auto_minmax(0,1fr)_auto] ${
        isCurrent ? "bg-spotify-tint" : "hover:bg-highlight"
      }`}
    >
      <div className="flex h-4 items-center justify-center">
        {isCurrent ? (
          <Equalizer />
        ) : (
          <>
            <span className="truncate font-mono text-sm tabular-nums text-dim group-hover:hidden">
              {index + 1}
            </span>
            <button
              type="button"
              onClick={play}
              aria-label={`Play ${track.title}`}
              className="hidden text-on group-hover:block"
            >
              <Music2 size={15} />
            </button>
          </>
        )}
      </div>

      {showArtwork ? (
        <button
          type="button"
          onClick={play}
          aria-hidden
          tabIndex={-1}
          className="hidden h-10 w-10 shrink-0 overflow-hidden rounded sm:block"
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
            <ImageOff size={14} className="mx-auto mt-3 text-white/40" />
          )}
        </button>
      ) : null}

      <button type="button" onClick={play} className="min-w-0 text-left">
        <p
          className={`truncate text-sm font-medium ${
            isCurrent ? "text-spotify" : "text-on"
          }`}
          title={track.title}
        >
          {track.title}
        </p>
        <p className="truncate text-xs text-sub" title={track.artist}>
          {track.artist || "—"}
        </p>
      </button>

      <div className="flex items-center gap-1">
        {actions}
        <button
          type="button"
          onClick={() => toggleLike(track)}
          aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
          aria-pressed={liked}
          className={`rounded-full p-1.5 transition ${
            liked
              ? "text-spotify"
              : "text-sub opacity-0 hover:text-on focus-visible:opacity-100 group-hover:opacity-100"
          }`}
        >
          <Heart size={15} fill={liked ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          onClick={() => {
            enqueueNext([track]);
            toast("Playing next", "success");
          }}
          aria-label={`Play ${track.title} next`}
          className="rounded-full p-1.5 text-sub opacity-0 transition hover:text-on focus-visible:opacity-100 group-hover:opacity-100"
        >
          <ListPlus size={15} />
        </button>
        {onAddToPlaylist ? (
          <button
            type="button"
            onClick={onAddToPlaylist}
            aria-label={`Add ${track.title} to a playlist`}
            className="rounded-full px-2 py-1 text-[10px] font-semibold text-sub opacity-0 transition hover:text-on focus-visible:opacity-100 group-hover:opacity-100"
          >
            + PLAYLIST
          </button>
        ) : null}
        {showDuration ? (
          <span className="ml-1 w-10 shrink-0 text-right font-mono text-xs tabular-nums text-dim">
            {duration}
          </span>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${track.title}`}
            className="rounded-full px-1.5 py-0.5 text-xs text-dim transition hover:text-on"
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A list of tracks with drag-to-reorder.
 *
 * Reordering is optimistic against the store; if the caller supplied
 * `onReorder` it also writes through to the playlist so the change survives a
 * reload.
 */
export function TrackList({
  tracks,
  onReorder,
  onPlayIndex,
  onRemove,
  onContextMenu,
  emptyLabel = "No tracks",
}: {
  tracks: Track[];
  onReorder?: (from: number, to: number) => void;
  onPlayIndex?: (index: number) => void;
  onRemove?: (index: number) => void;
  onContextMenu?: (e: React.MouseEvent, t: Track) => void;
  emptyLabel?: string;
}) {
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (!tracks.length) {
    return <p className="px-2 py-8 text-center text-sm text-dim">{emptyLabel}</p>;
  }

  return (
    <div role="table" className="flex flex-col">
      {tracks.map((track, i) => (
        <div
          key={`${trackKey(track)}:${i}`}
          draggable={Boolean(onReorder)}
          onDragStart={() => {
            dragIndex.current = i;
          }}
          onDragOver={(e) => {
            if (!onReorder) return;
            e.preventDefault();
            setOverIndex(i);
          }}
          onDragLeave={() => setOverIndex((v) => (v === i ? null : v))}
          onDrop={(e) => {
            if (!onReorder) return;
            e.preventDefault();
            const from = dragIndex.current;
            dragIndex.current = null;
            setOverIndex(null);
            if (from !== null && from !== i) onReorder(from, i);
          }}
          onDragEnd={() => {
            dragIndex.current = null;
            setOverIndex(null);
          }}
          className={overIndex === i ? "ring-1 ring-inset ring-spotify" : undefined}
        >
          <TrackRow
            track={track}
            index={i}
            onPlay={onPlayIndex ? () => onPlayIndex(i) : undefined}
            onRemove={onRemove ? () => onRemove(i) : undefined}
            onContextMenu={onContextMenu}
            showDuration
          />
        </div>
      ))}
    </div>
  );
}