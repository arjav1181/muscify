"use client";

import { useEffect, useRef } from "react";
import { createDeezerEngine } from "@/lib/engines/deezer-engine";
import { createRadioEngine } from "@/lib/engines/radio-engine";
import { createSoundcloudEngine } from "@/lib/engines/soundcloud-engine";
import type { EngineHandlers, PlaybackEngine } from "@/lib/engines/types";
import { createYoutubeEngine } from "@/lib/engines/youtube-engine";
import { registerEngineControl } from "@/lib/engines/control";
import { usePlayer } from "@/store/player-store";
import type { SourceId } from "@/lib/types";

const SOURCES: SourceId[] = ["youtube", "deezer", "soundcloud", "radio"];

/** Guard against a whole queue of dead embeds spinning the skip loop forever. */
const MAX_CONSECUTIVE_SKIPS = 8;

/**
 * Owns the four playback engines and reconciles them against the store.
 *
 * React never touches an engine directly: the store is the single source of
 * truth for *what* should be playing and *whether* it should be audible, and
 * these effects translate that into engine calls. Engine events flow back the
 * other way as store writes.
 *
 * Rendered once at the app root.
 */
export function PlayerHost() {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const needsGesture = usePlayer((s) => s.needsGesture);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const ducked = usePlayer((s) => s.ducked);

  const hosts = useRef<Partial<Record<SourceId, HTMLDivElement | null>>>({});
  const engines = useRef<Partial<Record<SourceId, PlaybackEngine>>>({});
  const activeSource = useRef<SourceId | null>(null);
  const skips = useRef(0);
  const skipWindow = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlers = useRef<EngineHandlers>({
    onState: (playing) => usePlayer.getState().setPlaying(playing),
    onEnded: () => {
      skips.current += 1;
      if (skipWindow.current) clearTimeout(skipWindow.current);
      skipWindow.current = setTimeout(() => {
        skips.current = 0;
      }, 10_000);

      if (skips.current > MAX_CONSECUTIVE_SKIPS) {
        const s = usePlayer.getState();
        s.setPlaying(false);
        s.setError("Nothing in this queue could be played.");
        return;
      }
      usePlayer.getState().next(true);
    },
    onError: (message) => usePlayer.getState().setError(message),
    onNeedsGesture: (needed) => usePlayer.getState().setNeedsGesture(needed),
    onPosition: (position, duration) => usePlayer.getState().setTimeline(position, duration),
    onLoading: (loading) => usePlayer.getState().setLoading(loading),
  });

  /**
   * Wrap the shared handlers so only the *active* engine can drive the store.
   *
   * Switching tracks stops the other three engines, and every engine's `stop()`
   * reports a state change as it shuts down. Without this guard those teardown
   * events race the track change itself and the incoming engine gets paused the
   * instant it starts — playback would die on every single skip.
   */
  const scoped = (source: SourceId): EngineHandlers => {
    const base = handlers.current;
    const mine = <T,>(run: (v: T) => void) => (v: T) => {
      if (activeSource.current === source) run(v);
    };
    return {
      onState: mine((playing) => base.onState(playing)),
      onEnded: () => {
        if (activeSource.current === source) base.onEnded();
      },
      onError: mine((m) => base.onError(m)),
      onNeedsGesture: mine((n) => base.onNeedsGesture(n)),
      onPosition: (position, duration) => {
        if (activeSource.current === source) base.onPosition(position, duration);
      },
      onLoading: mine((l) => base.onLoading(l)),
    };
  };

  // Create one engine per source, mounted into its own hidden host element.
  useEffect(() => {
    const registry = engines.current;
    for (const source of SOURCES) {
      const el = hosts.current[source];
      if (!el || registry[source]) continue;
      const h = scoped(source);
      const engine: PlaybackEngine =
        source === "youtube"
          ? createYoutubeEngine(h)
          : source === "deezer"
            ? createDeezerEngine(h)
            : source === "soundcloud"
              ? createSoundcloudEngine(h)
              : createRadioEngine(h);
      engine.mount(el);
      engine.setVolume(usePlayer.getState().volume);
      registry[source] = engine;
    }

    return () => {
      if (skipWindow.current) clearTimeout(skipWindow.current);
      for (const source of SOURCES) {
        registry[source]?.destroy();
        delete registry[source];
      }
      activeSource.current = null;
    };
  }, []);

  // Track switches: tear everything down, then start the incoming source.
  useEffect(() => {
    const state = usePlayer.getState();
    const target = track?.source ?? null;
    if (target === activeSource.current) return;

    // Claim the slot *before* tearing the others down, so their shutdown events
    // are correctly attributed to a stale engine and ignored.
    activeSource.current = target;

    for (const source of SOURCES) {
      if (source !== target) engines.current[source]?.stop();
    }

    if (!track || !target) {
      state.setSource(null);
      return;
    }
    state.setSource(target);
    state.setTimeline(0, 0);

    const engine = engines.current[target];
    if (!engine) return;
    engine.load(track);
    if (state.isPlaying) engine.play();
  }, [track]);

  // Transport: play / pause, including the tap that clears a gesture prompt.
  useEffect(() => {
    const source = activeSource.current;
    if (!source) return;
    const engine = engines.current[source];
    if (!engine) return;

    if (isPlaying) {
      if (needsGesture) usePlayer.getState().setNeedsGesture(false);
      engine.play();
    } else {
      engine.pause();
    }
  }, [isPlaying, needsGesture]);

  // Volume, mute and ducking all collapse into one effective level.
  useEffect(() => {
    const effective = ducked ? Math.round(volume * 0.25) : volume;
    const level = muted ? 0 : effective;
    for (const source of SOURCES) engines.current[source]?.setVolume(level);
  }, [volume, muted, ducked]);

  // Expose a seek command for the progress bar to call.
  useEffect(() => {
    registerEngineControl({
      seek: (fraction) => {
        const source = activeSource.current;
        if (source) engines.current[source]?.seekFraction(fraction);
      },
    });
    return () => registerEngineControl(null);
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed -left-[9999px] top-0 h-0 w-0 overflow-hidden">
      {SOURCES.map((source) => (
        <div
          key={source}
          ref={(el) => {
            hosts.current[source] = el;
          }}
        />
      ))}
    </div>
  );
}