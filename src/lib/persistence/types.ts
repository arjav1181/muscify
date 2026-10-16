import type { Track } from "@/lib/types";

/**
 * Persistence contract.
 *
 * Everything the app stores — playlists, liked songs, history, follows,
 * settings — goes through this interface. The shipped implementation is local
 * (localStorage, with an in-memory fallback for private-mode browsers), but
 * nothing above this line knows that: swapping in a REST or IndexedDB-backed
 * implementation requires no component changes.
 *
 * `Track` objects are stored whole rather than by id because not every track is
 * re-resolvable later — a radio stream in particular has no stable catalogue
 * entry to re-fetch.
 */

export interface Playlist {
  id: string;
  name: string;
  description: string;
  /** Ordered track keys. Duplicates are allowed, exactly like Spotify. */
  items: string[];
  createdAt: number;
  updatedAt: number;
  /** Primary artwork — a track key, falling back to a hue derived from the id. */
  coverKey?: string;
  collaborative?: boolean;
}

export interface LikedEntry {
  key: string;
  addedAt: number;
}

export interface RecentlyPlayed {
  key: string;
  playedAt: number;
  /** Times played in this install, used for the "most played" sort. */
  playCount: number;
}

export type RepeatMode = "off" | "all" | "one";

export interface Settings {
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  crossfadeSeconds: number;
  /** Seconds of the ending track to fade across. 0 disables. */
  fadeOutSeconds: number;
  /** Autoplay the next item when the queue finishes. */
  autoplay: boolean;
  /** Pause on tab blur — Spotify-style "pause when other audio is playing". */
  pauseOnBlur: boolean;
  /** Queue up similar tracks when the queue runs dry. */
  autoplaySimilar: boolean;
  /** Resolve and show lyrics when a track starts. */
  lyricsEnabled: boolean;
  /** Compact list density. */
  compactMode: boolean;
  /** Accent colour key from the theme palette. */
  accent: string;
  /** Radio autoplay behaviour. */
  sleepTimerMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 80,
  muted: false,
  shuffle: false,
  repeat: "off",
  crossfadeSeconds: 0,
  fadeOutSeconds: 4,
  autoplay: true,
  pauseOnBlur: false,
  autoplaySimilar: true,
  lyricsEnabled: true,
  compactMode: false,
  accent: "spotify",
  sleepTimerMinutes: 0,
};

export interface CatalogEntry {
  track: Track;
  updatedAt: number;
}

/** The full persisted shape of one install. */
export interface LibrarySnapshot {
  version: number;
  /** Track records keyed by `source:id`. */
  catalog: Record<string, CatalogEntry>;
  playlists: Playlist[];
  liked: LikedEntry[];
  recentlyPlayed: RecentlyPlayed[];
  followedArtists: string[];
  followedPlaylists: string[];
  settings: Settings;
}

export const SNAPSHOT_VERSION = 1;

export function emptySnapshot(): LibrarySnapshot {
  return {
    version: SNAPSHOT_VERSION,
    catalog: {},
    playlists: [],
    liked: [],
    recentlyPlayed: [],
    followedArtists: [],
    followedPlaylists: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * The storage boundary. Implementations must tolerate a corrupt or
 * version-mismatched payload by returning a fresh snapshot rather than throwing.
 */
export interface LibraryRepository {
  load(): Promise<LibrarySnapshot>;
  save(snapshot: LibrarySnapshot): Promise<void>;
  clear(): Promise<void>;
  /** False when running without persistence (private mode, quota exhausted). */
  readonly durable: boolean;
}