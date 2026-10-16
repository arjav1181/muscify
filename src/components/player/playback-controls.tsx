"use client";

import { usePlayer } from "@/store/player-store";
import { Loader2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";

export function PlaybackControls({ compact = false }: { compact?: boolean }) {
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isLoading = usePlayer((s) => s.isLoading);
  const hasTrack = usePlayer((s) => s.index >= 0);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const previous = usePlayer((s) => s.previous);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);

  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

  return (
    <div className="flex items-center justify-center gap-4">
      {!compact ? (
        <button
          type="button"
          onClick={toggleShuffle}
          aria-label="Shuffle"
          aria-pressed={shuffle}
          className={`transition-colors ${shuffle ? "text-spotify" : "text-sub hover:text-on"}`}
        >
          <Shuffle size={17} />
        </button>
      ) : null}

      <button
        type="button"
        onClick={previous}
        disabled={!hasTrack}
        aria-label="Previous"
        className="text-sub transition-colors hover:text-on disabled:opacity-40"
      >
        <SkipBack size={20} fill="currentColor" />
      </button>

      <button
        type="button"
        onClick={toggle}
        disabled={!hasTrack}
        aria-label={isPlaying ? "Pause" : "Play"}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-on text-black transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
      >
        {isLoading ? (
          <Loader2 size={17} className="animate-spin" />
        ) : isPlaying ? (
          <Pause size={17} fill="currentColor" />
        ) : (
          <Play size={17} fill="currentColor" className="translate-x-[1px]" />
        )}
      </button>

      <button
        type="button"
        onClick={() => next(false)}
        disabled={!hasTrack}
        aria-label="Next"
        className="text-sub transition-colors hover:text-on disabled:opacity-40"
      >
        <SkipForward size={20} fill="currentColor" />
      </button>

      {!compact ? (
        <button
          type="button"
          onClick={cycleRepeat}
          aria-label={`Repeat: ${repeat}`}
          className={`transition-colors ${repeat !== "off" ? "text-spotify" : "text-sub hover:text-on"}`}
        >
          <RepeatIcon size={17} />
        </button>
      ) : null}
    </div>
  );
}