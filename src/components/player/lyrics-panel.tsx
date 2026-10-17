"use client";

import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { activeLineIndex, useLyrics } from "@/hooks/use-lyrics";
import { buildWordTimings, wordProgress } from "@/lib/lyrics/word-sync";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";

/**
 * Synced lyrics panel.
 *
 * The active line is computed from a single subscription to the player's
 * position, and auto-scroll only engages while the pointer is outside the
 * panel — otherwise scrolling fights the user, which is the classic failure
 * mode of lyric views.
 */
export function LyricsPanel() {
  const position = usePlayer((s) => s.position);
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const enabled = useLibrary((s) => s.settings.lyricsEnabled);
  const setLyricsOpen = useUi((s) => s.setLyricsOpen);

  const { result, loading, error } = useLyrics(enabled ? track : null);
  const karaoke = useLibrary((s) => s.settings.karaokeLyrics);

  // Dependencies must name `result`, not `result.lines` — the compiler infers
  // the whole object and rejects a narrower list.
  const timings = useMemo(
    () => (result?.lines.length ? buildWordTimings(result.lines) : []),
    [result],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const activeRef = useRef(-1);

  const active =
    result?.lines.length && enabled ? activeLineIndex(result.lines, position) : -1;

  // Effect depends on the index, not the raw position, so this runs once per
  // line rather than twice a second.
  useEffect(() => {
    activeRef.current = active;
    if (!shouldAutoScroll.current || active < 0) return;
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  return (
    <aside
      aria-label="Lyrics"
      onPointerEnter={() => {
        shouldAutoScroll.current = false;
      }}
      onPointerLeave={() => {
        shouldAutoScroll.current = true;
      }}
      className="flex h-full w-full flex-col overflow-hidden border-l border-line bg-base lg:w-[380px]"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-on">Lyrics</h2>
        <button
          type="button"
          onClick={() => setLyricsOpen(false)}
          aria-label="Close lyrics"
          className="rounded-full p-1 text-dim transition hover:text-on"
        >
          <X size={16} />
        </button>
      </header>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-sub">
            <Loader2 size={15} className="animate-spin" /> Finding lyrics…
          </p>
        ) : error ? (
          <div className="text-sm">
            <p className="mb-3 flex items-center gap-2 text-sub">
              <AlertTriangle size={15} /> {error}
            </p>
            <p className="text-xs leading-relaxed text-dim">
              Lyrics come from LRCLIB, a free community database of transcriptions. Not
              every track has one.
            </p>
          </div>
        ) : result?.lines.length ? (
          <div className="space-y-4">
            {result.lines.map((line, i) => (
              <p
                key={`${line.time}-${i}`}
                data-line={i}
                className={`text-lg leading-snug font-bold transition-colors ${
                  i === active ? "text-on" : "text-dim"
                }`}
              >
                {i === active && karaoke
                  ? // Word-level sweep. Timings are interpolated within each
                    // line from LRCLIB's line timestamps, so they re-anchor
                    // every line instead of drifting.
                    timings
                      .filter((w) => w.lineIndex === i)
                      .map((word) => (
                        <span key={word.start} className="relative inline-block">
                          <span className="text-dim">{word.word}</span>
                          <span
                            aria-hidden
                            className="absolute inset-0 overflow-hidden whitespace-pre text-on"
                            style={{ width: `${wordProgress(word, position) * 100}%` }}
                          >
                            {word.word}
                          </span>
                          {" "}
                        </span>
                      ))
                  : line.text}
              </p>
            ))}
            <p className="pt-4 text-xs text-dim">
              Source: {result.source}
              {karaoke ? " · word timing interpolated from line timestamps, not forced-aligned" : null}
            </p>
          </div>
        ) : result?.plain ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-sub">{result.plain}</p>
        ) : (
          <p className="text-sm text-dim">No lyrics available for this track.</p>
        )}
      </div>
    </aside>
  );
}