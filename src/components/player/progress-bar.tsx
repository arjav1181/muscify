"use client";

import { useCallback, useRef, useState } from "react";
import { seekTo } from "@/lib/engines/control";
import { formatTime } from "@/lib/format";
import { usePlayer } from "@/store/player-store";

const LIVE = "radio";

export function ProgressBar() {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const isPlaying = usePlayer((s) => s.isPlaying);

  const barRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragFraction, setDragFraction] = useState(0);

  // Live streams and sources without a controllable timeline (Deezer's widget
  // exposes neither duration nor seek) render as a static, non-interactive bar.
  const isLive = track?.source === LIVE;
  const seekable = !isLive && duration > 0 && track?.source !== "deezer";

  const committedFraction = duration > 0 ? Math.min(1, position / duration) : 0;
  const fraction = dragging ? dragFraction : committedFraction;

  const fractionFromEvent = useCallback((clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const commit = useCallback(
    (clientX: number) => {
      if (!seekable) return;
      seekTo(fractionFromEvent(clientX));
    },
    [seekable, fractionFromEvent],
  );

  if (!track) return <div className="h-1 w-full bg-highlight" />;

  const hoverFraction =
    hoverX !== null && seekable && duration > 0 && barWidth > 0
      ? Math.min(1, Math.max(0, hoverX / barWidth))
      : null;

  const label = isLive
    ? "LIVE"
    : duration > 0
      ? `${formatTime(position)} / ${formatTime(duration)}`
      : formatTime(position);

  return (
    <div className="group relative flex items-center gap-2">
      <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-sub">
        {label}
      </span>

      <div
        ref={barRef}
        role={seekable ? "slider" : undefined}
        aria-label="Seek"
        aria-valuemin={seekable ? 0 : undefined}
        aria-valuemax={seekable ? Math.round(duration) : undefined}
        aria-valuenow={seekable ? Math.round(position) : undefined}
        aria-valuetext={label}
        tabIndex={seekable ? 0 : -1}
        className={`relative h-1 w-full rounded-full bg-highlight transition-[height] ${
          seekable ? "cursor-pointer group-hover:h-1.5" : ""
        }`}
        onMouseDown={(e) => {
          if (!seekable) return;
          setDragFraction(fractionFromEvent(e.clientX));
          setDragging(true);
        }}
        onMouseMove={(e) => {
          const rect = barRef.current?.getBoundingClientRect();
          if (!rect) return;
          setBarWidth(rect.width);
          setHoverX(e.clientX - rect.left);
        }}
        onMouseLeave={() => setHoverX(null)}
        onMouseUp={(e) => {
          if (!seekable) return;
          commit(e.clientX);
          setDragging(false);
        }}
        onKeyDown={(e) => {
          if (!seekable) return;
          if (e.key === "ArrowRight") {
            e.preventDefault();
            seekTo(Math.min(1, committedFraction + 0.05));
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            seekTo(Math.max(0, committedFraction - 0.05));
          }
        }}
      >
        {hoverFraction !== null && !dragging ? (
          <div
            className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-highlight px-1.5 py-0.5 font-mono text-[10px] text-on"
            style={{ left: `${hoverFraction * 100}%` }}
          >
            {formatTime(hoverFraction * duration)}
          </div>
        ) : null}

        <div
          className={`h-full rounded-full transition-[width] duration-100 ${
            isLive ? "bg-spotify/40" : "bg-spotify"
          }`}
          style={{ width: `${(isLive ? 1 : fraction) * 100}%` }}
        />

        {seekable ? (
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-on opacity-0 shadow-md transition-opacity group-hover:opacity-100"
            style={{ left: `${fraction * 100}%` }}
          />
        ) : null}

        {isLive && isPlaying ? (
          <span className="absolute right-0 top-1/2 -translate-y-1/2 font-mono text-[9px] font-bold tracking-widest text-spotify">
            ON AIR
          </span>
        ) : null}
      </div>
    </div>
  );
}