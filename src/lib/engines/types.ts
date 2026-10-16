import type { SourceId, Track } from "@/lib/types";

export interface EngineHandlers {
  onState(playing: boolean): void;
  onEnded(): void;
  onError(message: string): void;
  /**
   * Autoplay policy blocked playback and the UI must offer an explicit tap.
   * Pass false to clear the prompt once playback actually starts.
   */
  onNeedsGesture(needed: boolean): void;
  onPosition(position: number, duration: number): void;
  onLoading(loading: boolean): void;
}

/**
 * One uniform surface over four very different providers.
 *
 * The engines stay deliberately "faithful" to each provider's official
 * capabilities rather than emulating a richer player — Deezer's widget exposes
 * no pause API, so pause is implemented as a stop. Callers get identical
 * play/pause/seek/volume semantics regardless of source.
 */
export interface PlaybackEngine {
  readonly source: SourceId;
  mount(container: HTMLElement): void;
  load(track: Track): void;
  play(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Fraction of the track, 0–1. Ignored by live streams. */
  seekFraction(fraction: number): void;
  /** 0–100. */
  setVolume(volume: number): void;
  position(): number;
  duration(): number;
  destroy(): void;
}

export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/**
 * YouTube error codes we can act on. 2 = bad param, 5 = HTML5/API error,
 * 100/101/150 = removed or embedding disallowed — in every case the right move
 * is to skip rather than leave a dead track stuck in the player.
 */
export const SKIPPABLE_YT_ERRORS = new Set([2, 5, 100, 101, 150]);