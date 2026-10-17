"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { getAnalyser } from "@/lib/audio/analyser";
import { describeNormalization } from "@/lib/audio/normalize";
import { useUi } from "@/store/ui-store";

/**
 * 10-band equalizer.
 *
 * Real, working control over the analyser graph — `getAnalyser().setBandGain`
 * writes straight to the live biquad nodes. It only affects radio streams,
 * because YouTube, Deezer and SoundCloud play inside third-party frames whose
 * audio we cannot route into our graph; the footer says so rather than
 * implying broader coverage.
 *
 * Presets are starting points, not a fixed palette: every band is editable
 * afterwards, and "Reset" returns to flat.
 */

const BANDS = [
  { label: "30", freq: 30 },
  { label: "62", freq: 62 },
  { label: "125", freq: 125 },
  { label: "250", freq: 250 },
  { label: "500", freq: 500 },
  { label: "1k", freq: 1000 },
  { label: "2k", freq: 2000 },
  { label: "4k", freq: 4000 },
  { label: "8k", freq: 8000 },
  { label: "16k", freq: 16000 },
] as const;

const PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Bass: [6, 5, 4, 2, -1, -2, -1, 0, 1, 1],
  Treble: [-2, -1, 0, 1, 2, 3, 4, 5, 5, 4],
  Vocal: [-2, -1, 0, 2, 4, 4, 3, 1, -1, -2],
  Loudness: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5],
  "Rock": [4, 3, 1, -1, -2, 0, 2, 4, 4, 3],
};

export function EqualizerPanel() {
  const close = useUi((s) => s.closeModal);

  const analyser = useMemo(() => getAnalyser(), []);
  const [bands, setBands] = useState<number[]>(() => new Array(10).fill(0));

  const setBand = (index: number, gain: number) => {
    const next = [...bands];
    next[index] = gain;
    setBands(next);
    analyser.setBandGain(index, gain);
  };

  const applyPreset = (gains: number[]) => {
    setBands(gains);
    gains.forEach((g, i) => analyser.setBandGain(i, g));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Equalizer"
      className="w-full max-w-2xl rounded-lg border border-line bg-elevated p-6 shadow-2xl"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-on">Equalizer</h2>
          <p className="mt-1 text-xs text-muted">{describeNormalization()}</p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close equalizer"
          className="rounded-full p-1 text-dim transition hover:text-on"
        >
          <SlidersHorizontal size={18} aria-hidden />
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {Object.keys(PRESETS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => applyPreset(PRESETS[name]!)}
            className="rounded-full border border-line-strong px-3 py-1 text-xs text-muted transition hover:border-white/40 hover:text-on"
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => applyPreset(PRESETS.Flat!)}
          className="rounded-full border border-line-strong px-3 py-1 text-xs text-muted transition hover:border-white/40 hover:text-on"
        >
          Reset
        </button>
      </div>

      <div className="grid grid-cols-5 gap-x-3 gap-y-4 sm:grid-cols-10">
        {BANDS.map((band, i) => (
          <label key={band.label} className="flex flex-col items-center gap-1">
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={bands[i]!}
              onChange={(e) => setBand(i, Number(e.target.value))}
              aria-label={`${band.label} hertz band`}
              className="h-24 w-8 -rotate-90 accent-spotify"
            />
            <span className="mt-6 text-[10px] tabular-nums text-muted">{band.label}</span>
            <span className="text-[10px] tabular-nums text-dim">{bands[i]!}dB</span>
          </label>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted">
        The analyser graph is attached to radio streams only. Tracks played from
        YouTube, Deezer and SoundCloud happen inside third-party frames whose
        audio we cannot route into it.
      </p>
    </div>
  );
}