"use client";

import { Timer } from "lucide-react";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";

const PRESETS = [5, 10, 15, 30, 45, 60, 90, 120];

/**
 * Sleep timer: stop playback after N minutes.
 *
 * The countdown comes from the store, which owns the ticker — reading the clock
 * here would both break static prerendering and give every consumer its own
 * drifting interval.
 */
export function SleepTimerMenu() {
  const endsAt = usePlayer((s) => s.sleepTimerEndsAt);
  const remaining = usePlayer((s) => s.sleepTimerRemaining);
  const start = usePlayer((s) => s.startSleepTimer);
  const cancel = usePlayer((s) => s.cancelSleepTimer);
  const openContextMenu = useUi((s) => s.openContextMenu);

  return (
    <button
      type="button"
      aria-label={remaining ? `Sleep timer, ${remaining} minutes left` : "Sleep timer"}
      title={remaining ? `Sleep timer: ${remaining}m left` : "Sleep timer"}
      onClick={(e) => {
        const items: { label: string; run: () => void }[] = PRESETS.map((minutes) => ({
          label: `${minutes} minutes`,
          run: () => start(minutes),
        }));
        if (endsAt) items.push({ label: "End sleep timer", run: cancel });
        openContextMenu(e.clientX, e.clientY, items);
      }}
      className={`flex items-center gap-1 rounded-full p-2 transition hover:bg-highlight ${
        remaining ? "text-spotify" : "text-sub hover:text-on"
      }`}
    >
      <Timer size={16} />
      {remaining ? (
        <span className="text-[10px] font-bold tabular-nums">{remaining}m</span>
      ) : null}
    </button>
  );
}