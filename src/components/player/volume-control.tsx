"use client";

import { Volume1, Volume2, VolumeX } from "lucide-react";
import { usePlayer } from "@/store/player-store";

/**
 * Volume, as a mute button plus a range input.
 *
 * `wide` is for the Now Playing view on a phone. The bar's default is w-24,
 * which is right beside the other desktop controls and far too narrow to drag
 * with a thumb — the two places that use this have genuinely different needs,
 * so the difference is a prop rather than a second component with duplicated
 * state handling.
 */
export function VolumeControl({ wide = false }: { wide?: boolean }) {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);

  const effective = muted ? 0 : volume;
  const Icon = effective === 0 ? VolumeX : effective < 50 ? Volume1 : Volume2;

  return (
    <div className={wide ? "flex w-full items-center gap-3" : "flex items-center gap-2"}>
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        className="rounded-full p-1.5 text-sub transition-colors hover:text-on"
      >
        <Icon size={18} />
      </button>
      <input
        type="range"
        className={wide ? "mus-range flex-1" : "mus-range w-24"}
        min={0}
        max={100}
        value={effective}
        aria-label="Volume"
        style={{ "--fill": `${effective}%` } as React.CSSProperties}
        onChange={(e) => setVolume(Number(e.target.value))}
      />
    </div>
  );
}