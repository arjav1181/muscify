"use client";

import { Volume1, Volume2, VolumeX } from "lucide-react";
import { usePlayer } from "@/store/player-store";

export function VolumeControl() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);

  const effective = muted ? 0 : volume;
  const Icon = effective === 0 ? VolumeX : effective < 50 ? Volume1 : Volume2;

  return (
    <div className="flex items-center gap-2">
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
        className="mus-range w-24"
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