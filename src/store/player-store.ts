"use client";

import { create } from "zustand";
import { trackKey, type Track } from "@/lib/types";
import type { RepeatMode } from "@/lib/persistence/types";
import { useLibrary } from "./library-store";

export type { RepeatMode };

interface PlayerState {
  queue: Track[];
  index: number;
  /** Provenance of the current queue, so "go to album" can be a no-op when already there. */
  origin: { kind: string; id: string } | null;

  isPlaying: boolean;
  isLoading: boolean;
  needsGesture: boolean;

  position: number;
  duration: number;

  volume: number;
  muted: boolean;
  lastAudibleVolume: number;
  /** Volume immediately before a duck/fade, so it can be restored exactly. */
  preDuckVolume: number;

  shuffle: boolean;
  repeat: RepeatMode;

  /** Fade state: non-zero while a crossfade ramp is in progress. */
  fade: { direction: "in" | "out"; startedAt: number; durationMs: number } | null;

  error: string | null;
  /** Set when the provider's playback surface refused to start. Carries a
   *  ready-made alternative so the user isn't left at a dead end. */
  unavailable: { message: string; query: string } | null;
  activeSource: Track["source"] | null;
  ducked: boolean;
  /** Epoch ms at which the sleep timer fires; 0 = inactive. */
  sleepTimerEndsAt: number;
  /**
   * Minutes left on the sleep timer, maintained by the store's own ticker.
   *
   * Derived here rather than in the UI because Date.now() during render is an
   * unstable value that breaks static prerendering, and a per-component
   * interval would mean several of them drifting apart.
   */
  sleepTimerRemaining: number;

  /** Playback history for the "recently played" rail and back navigation. */
  navigationDepth: number;

  playTracks: (tracks: Track[], startIndex?: number, origin?: { kind: string; id: string }) => void;
  enqueue: (tracks: Track[]) => void;
  enqueueNext: (tracks: Track[]) => void;
  replaceQueue: (tracks: Track[], index?: number) => void;
  toggle: () => void;
  next: (fromTrackEnd?: boolean) => void;
  previous: () => void;
  jump: (index: number) => void;
  remove: (index: number) => void;
  reorder: (from: number, to: number) => void;
  clearQueue: () => void;

  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setRepeat: (repeat: RepeatMode) => void;

  setPlaying: (playing: boolean) => void;
  setLoading: (loading: boolean) => void;
  setNeedsGesture: (needed: boolean) => void;
  setTimeline: (position: number, duration: number) => void;
  setSource: (source: Track["source"] | null) => void;
  setError: (error: string | null) => void;
  setUnavailable: (state: { message: string; query: string } | null) => void;
  /**
   * Dismisses the notice and returns the search query for the unplayable track.
   * Navigation stays in the component — a store shouldn't own routing.
   */
  takeYoutubeFallback: () => string | null;
  setFade: (fade: PlayerState["fade"]) => void;
  duck: (ms?: number) => void;
  /** Snapshots volume, ramps the store to `from`, then calls back when done. */
  runFade: (from: number, to: number, durationMs: number, onDone?: () => void) => void;

  startSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
}

let duckTimer: ReturnType<typeof setTimeout> | null = null;
let sleepTicker: ReturnType<typeof setInterval> | null = null;
let fadeFrame: number | null = null;

export const usePlayer = create<PlayerState>((set, get) => {
  /** Advance to `target`, or stop when the queue end is reached without repeat. */
  const goTo = (target: number, play: boolean) => {
    const { queue } = get();
    if (target < 0 || target >= queue.length) return;
    const track = queue[target];
    set({
      index: target,
      position: 0,
      duration: track.duration ?? 0,
      isPlaying: play,
      needsGesture: false,
      error: null,
      activeSource: track.source,
    });
  };

  const stopAtEnd = () => {
    set({ isPlaying: false, position: 0 });
  };

  return {
    queue: [],
    index: -1,
    origin: null,

    isPlaying: false,
    isLoading: false,
    needsGesture: false,

    position: 0,
    duration: 0,

    volume: 80,
    muted: false,
    lastAudibleVolume: 80,
    preDuckVolume: 80,

    shuffle: false,
    repeat: "off",

    fade: null,

    error: null,
    unavailable: null,
    activeSource: null,
    ducked: false,
    sleepTimerEndsAt: 0,
    sleepTimerRemaining: 0,

    navigationDepth: 0,

    playTracks: (tracks, startIndex = 0, origin) => {
      const clean = tracks.filter((t) => t?.id);
      if (!clean.length) return;
      const index = Math.min(Math.max(0, startIndex), clean.length - 1);
      useLibrary.getState().putTracks(clean);
      useLibrary.getState().recordPlay(clean[index]);
      set({
        queue: clean,
        index,
        origin: origin ?? null,
        position: 0,
        duration: clean[index].duration ?? 0,
        isPlaying: true,
        needsGesture: false,
        error: null,
        activeSource: clean[index].source,
        navigationDepth: 0,
      });
    },

    enqueue: (tracks) => {
      const clean = tracks.filter((t) => t?.id);
      if (!clean.length) return;
      useLibrary.getState().putTracks(clean);
      set((s) => ({ queue: [...s.queue, ...clean] }));
    },

    enqueueNext: (tracks) => {
      const clean = tracks.filter((t) => t?.id);
      if (!clean.length) return;
      useLibrary.getState().putTracks(clean);
      set((s) => {
        const at = s.index < 0 ? 0 : s.index + 1;
        const queue = [...s.queue];
        queue.splice(at, 0, ...clean);
        return { queue };
      });
    },

    replaceQueue: (tracks, index = 0) => {
      const clean = tracks.filter((t) => t?.id);
      if (!clean.length) return;
      useLibrary.getState().putTracks(clean);
      goTo(Math.min(Math.max(0, index), clean.length - 1), true);
    },

    toggle: () => {
      const { queue, isPlaying, needsGesture } = get();
      if (!queue.length) return;
      if (needsGesture) {
        set({ needsGesture: false, isPlaying: true });
        return;
      }
      set({ isPlaying: !isPlaying });
    },

    next: (fromTrackEnd = false) => {
      const { queue, index, repeat, shuffle } = get();
      if (!queue.length) return;

      // Bank the listen before moving on, so stats reflect what was actually
      // heard. Capped at the track length: a track left paused overnight must
      // not register eight hours of listening.
      if (index >= 0 && index < queue.length) {
        const track = queue[index];
        const listened = Math.round(Math.min(get().position, track.duration ?? Infinity) * 1000);
        useLibrary.getState().notePlay(track, listened);
      }

      if (fromTrackEnd && repeat === "one") {
        set({ position: 0, isPlaying: true, needsGesture: false });
        return;
      }
      if (queue.length === 1) {
        if (fromTrackEnd && repeat === "off") stopAtEnd();
        else set({ position: 0, isPlaying: true, needsGesture: false });
        return;
      }

      let target: number;
      if (shuffle) {
        let candidate = index;
        // Avoid an immediate self-repeat when there are alternatives.
        let guard = 0;
        do {
          candidate = Math.floor(Math.random() * queue.length);
          guard += 1;
        } while (candidate === index && guard < 12);
        target = candidate;
      } else if (index + 1 < queue.length) {
        target = index + 1;
      } else if (repeat === "all") {
        target = 0;
      } else if (fromTrackEnd) {
        stopAtEnd();
        return;
      } else {
        // A user-initiated skip at the end wraps, as in every music player.
        target = 0;
      }
      goTo(target, true);
    },

    previous: () => {
      const { queue, index, position, shuffle } = get();
      if (!queue.length) return;
      if (position > 3 && !shuffle) {
        set({ position: 0 });
        return;
      }
      goTo(index > 0 ? index - 1 : queue.length - 1, true);
    },

    jump: (index: number) => goTo(index, true),

    remove: (index) => {
      const { queue, index: current, isPlaying } = get();
      if (index < 0 || index >= queue.length) return;
      const nextQueue = queue.filter((_, i) => i !== index);
      if (!nextQueue.length) {
        set({
          queue: [],
          index: -1,
          isPlaying: false,
          position: 0,
          duration: 0,
          activeSource: null,
          origin: null,
        });
        return;
      }
      if (index < current) set({ queue: nextQueue, index: current - 1 });
      else if (index === current) goTo(Math.min(current, nextQueue.length - 1), isPlaying);
      else set({ queue: nextQueue });
    },

    reorder: (from, to) => {
      const { queue, index } = get();
      if (from < 0 || from >= queue.length) return;
      const items = [...queue];
      const [moved] = items.splice(from, 1);
      items.splice(Math.max(0, Math.min(items.length, to)), 0, moved);
      // Keep the playhead pointing at the same track, not the same index.
      let nextIndex = index;
      if (index === from) nextIndex = to;
      else if (from < index && to >= index) nextIndex = index - 1;
      else if (from > index && to <= index) nextIndex = index + 1;
      set({ queue: items, index: nextIndex });
    },

    clearQueue: () =>
      set({
        queue: [],
        index: -1,
        isPlaying: false,
        position: 0,
        duration: 0,
        activeSource: null,
        origin: null,
      }),

    setVolume: (volume) => {
      const v = Math.max(0, Math.min(100, Math.round(volume)));
      set({
        volume: v,
        muted: v === 0,
        lastAudibleVolume: v > 0 ? v : get().lastAudibleVolume,
      });
      useLibrary.getState().updateSettings({ volume: v, muted: v === 0 });
    },

    toggleMute: () => {
      const { muted, lastAudibleVolume, volume } = get();
      const settings = useLibrary.getState().settings;
      if (muted || volume === 0) {
        const restore = lastAudibleVolume || 80;
        set({ muted: false, volume: restore, lastAudibleVolume: restore });
        useLibrary.getState().updateSettings({ ...settings, volume: restore, muted: false });
      } else {
        set({ muted: true, lastAudibleVolume: volume });
        useLibrary.getState().updateSettings({ ...settings, muted: true });
      }
    },

    toggleShuffle: () => {
      const shuffle = !get().shuffle;
      set({ shuffle });
      useLibrary.getState().updateSettings({ shuffle });
    },

    cycleRepeat: () => {
      const order: RepeatMode[] = ["off", "all", "one"];
      const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
      set({ repeat });
      useLibrary.getState().updateSettings({ repeat });
    },

    setRepeat: (repeat) => {
      set({ repeat });
      useLibrary.getState().updateSettings({ repeat });
    },

    setPlaying: (playing) => set({ isPlaying: playing }),
    setLoading: (loading) => set({ isLoading: loading }),
    setNeedsGesture: (needed) => set({ needsGesture: needed }),
    setTimeline: (position, duration) =>
      set((s) => ({
        position: Number.isFinite(position) ? Math.max(0, position) : s.position,
        // Never clobber a known duration with 0 from a source that doesn't
        // report one (Deezer, SoundCloud) — that would break the progress bar.
        duration: Number.isFinite(duration) && duration > 0 ? duration : s.duration,
      })),
    setSource: (source) => set({ activeSource: source }),
    setError: (error) => set({ error, isLoading: false }),

    setUnavailable: (unavailable) => set({ unavailable, isLoading: false }),

    takeYoutubeFallback: () => {
      const query = get().unavailable?.query;
      if (!query) return null;
      set({ unavailable: null });
      return query;
    },
    setFade: (fade) => set({ fade }),

    duck: (ms = 2500) => {
      // Remember the level we're ducking so we restore it rather than guessing.
      const current = get().volume;
      set({ ducked: true, preDuckVolume: current > 0 ? current : get().preDuckVolume });
      if (duckTimer) clearTimeout(duckTimer);
      duckTimer = setTimeout(() => {
        duckTimer = null;
        set({ ducked: false });
      }, ms);
    },

    /**
     * Volume ramp driven by the store, so every engine follows it through the
     * same effect rather than each implementing its own ramp.
     *
     * The pre-fade level is captured on the first call of a ramp and released on
     * the last, which makes chained fades (crossfade out → in) restore the
     * user's actual volume instead of compounding.
     */
    runFade: (from, to, durationMs, onDone) => {
      const current = get().volume;
      if (durationMs <= 0) {
        set({ volume: to });
        onDone?.();
        return;
      }
      if (current > 0 && from >= current) set({ preDuckVolume: current });

      const startedAt = performance.now();
      set({ fade: { direction: to < from ? "out" : "in", startedAt, durationMs } });

      const tick = () => {
        const elapsed = performance.now() - startedAt;
        const t = Math.min(1, elapsed / durationMs);
        // Equal-power curve: a linear ramp sounds like it drops off a cliff.
        const gain = Math.cos((t * Math.PI) / 2);
        set({ volume: Math.round(from + (to - from) * gain) });

        if (t < 1) {
          fadeFrame = requestAnimationFrame(tick);
        } else {
          fadeFrame = null;
          set({ volume: to, fade: null });
          onDone?.();
        }
      };
      if (fadeFrame) cancelAnimationFrame(fadeFrame);
      fadeFrame = requestAnimationFrame(tick);
    },

    startSleepTimer: (minutes) => {
      if (minutes <= 0) {
        get().cancelSleepTimer();
        return;
      }
      set({
        sleepTimerEndsAt: Date.now() + minutes * 60_000,
        sleepTimerRemaining: minutes,
      });
      if (sleepTicker) clearInterval(sleepTicker);
      sleepTicker = setInterval(() => {
        const endsAt = get().sleepTimerEndsAt;
        if (!endsAt) {
          if (sleepTicker) clearInterval(sleepTicker);
          sleepTicker = null;
          return;
        }
        const left = endsAt - Date.now();
        if (left <= 0) {
          set({ isPlaying: false, sleepTimerEndsAt: 0, sleepTimerRemaining: 0 });
          if (sleepTicker) clearInterval(sleepTicker);
          sleepTicker = null;
          return;
        }
        set({ sleepTimerRemaining: Math.max(1, Math.ceil(left / 60_000)) });
      }, 1000);
    },

    cancelSleepTimer: () => {
      if (sleepTicker) clearInterval(sleepTicker);
      sleepTicker = null;
      set({ sleepTimerEndsAt: 0, sleepTimerRemaining: 0 });
    },
  };
});

export const selectCurrent = (s: PlayerState): Track | null => s.queue[s.index] ?? null;
export const selectCurrentKey = (s: PlayerState): string | null => {
  const track = s.queue[s.index];
  return track ? trackKey(track) : null;
};
export const selectIsCurrentPlaying = (key: string) => (s: PlayerState) =>
  s.index >= 0 && trackKey(s.queue[s.index] ?? ({} as Track)) === key && s.isPlaying;