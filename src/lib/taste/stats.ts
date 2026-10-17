/**
 * Listening statistics derived from recorded play events.
 *
 * Pure functions over the play log, so the numbers can be tested against
 * synthetic history rather than eyeballed in the UI. Every aggregate here
 * respects Private Session: those events exist for playback continuity and are
 * excluded from anything presented as a fact about the listener.
 */

// The `.ts` extension is required here: Node's ESM resolver will not guess it
// when the test runner loads this file directly.
import { PLAY_THRESHOLD_MS, type PlayEvent } from "./taste.ts";

export interface TrackStat {
  key: string;
  plays: number;
  /** Total milliseconds listened. */
  ms: number;
  lastPlayedAt: number;
}

export interface ArtistStat {
  /** Artist display name — the only identity we can join on locally. */
  name: string;
  plays: number;
  ms: number;
  /** Distinct tracks attributed to this artist. */
  tracks: number;
}

export interface DayPoint {
  /** `YYYY-MM-DD` in local time. */
  day: string;
  ms: number;
  plays: number;
}

export interface ListeningStats {
  /** Listened time across all counted events. */
  totalMs: number;
  plays: number;
  uniqueTracks: number;
  uniqueArtists: number;
  /** Average listened fraction, 0..1, over events with a known duration. */
  completion: number;
  topTracks: TrackStat[];
  topArtists: ArtistStat[];
  /** Plays per hour of day, 0..23. Reveals listening rhythm. */
  byHour: number[];
  /** Oldest-to-newest daily totals, so a chart can read left to right. */
  byDay: DayPoint[];
  /** Events skipped because they were recorded in a Private Session. */
  privateExcluded: number;
}

/** Resolves a track key to its artist name and duration. */
export type TrackResolver = (
  key: string,
) => { artist: string; durationMs?: number } | undefined;

const isCountable = (e: PlayEvent) => !e.private && e.ms >= PLAY_THRESHOLD_MS;

export function computeStats(plays: PlayEvent[], resolve: TrackResolver): ListeningStats {
  const tracks = new Map<string, TrackStat>();
  const artists = new Map<string, ArtistStat>();
  const hours = new Array<number>(24).fill(0);
  const days = new Map<string, DayPoint>();

  let totalMs = 0;
  let count = 0;
  let privateExcluded = 0;
  let completedMs = 0;
  let completedDurations = 0;

  for (const event of plays) {
    if (event.private) {
      privateExcluded++;
      continue;
    }
    if (event.ms < PLAY_THRESHOLD_MS) continue;

    count++;
    totalMs += event.ms;
    hours[new Date(event.at).getHours()]++;

    const day = localDay(event.at);
    const point = days.get(day) ?? { day, ms: 0, plays: 0 };
    point.ms += event.ms;
    point.plays++;
    days.set(day, point);

    const stat = tracks.get(event.key) ?? {
      key: event.key,
      plays: 0,
      ms: 0,
      lastPlayedAt: 0,
    };
    stat.plays++;
    stat.ms += event.ms;
    stat.lastPlayedAt = Math.max(stat.lastPlayedAt, event.at);
    tracks.set(event.key, stat);

    const meta = resolve(event.key);
    if (meta) {
      const a = artists.get(meta.artist) ?? {
        name: meta.artist,
        plays: 0,
        ms: 0,
        tracks: 0,
      };
      a.plays++;
      a.ms += event.ms;
      if (!tracks.get(event.key) || a.tracks === 0) a.tracks++;
      // Counted again below to avoid double work; see uniqueArtistKeys.
      artists.set(meta.artist, a);

      if (meta.durationMs && meta.durationMs > 0) {
        completedMs += Math.min(event.ms, meta.durationMs);
        completedDurations += meta.durationMs;
      }
    }
  }

  // Distinct-track counts per artist need a set, not an increment, because the
  // same track can appear under two events.
  const artistKeys = new Map<string, Set<string>>();
  for (const event of plays) {
    if (!isCountable(event)) continue;
    const meta = resolve(event.key);
    if (!meta) continue;
    const set = artistKeys.get(meta.artist) ?? new Set<string>();
    set.add(event.key);
    artistKeys.set(meta.artist, set);
  }
  for (const [name, set] of artistKeys) {
    const stat = artists.get(name);
    if (stat) stat.tracks = set.size;
  }

  const byDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));

  return {
    totalMs,
    plays: count,
    uniqueTracks: tracks.size,
    uniqueArtists: artists.size,
    completion: completedDurations > 0 ? completedMs / completedDurations : 0,
    topTracks: [...tracks.values()].sort((a, b) => b.ms - a.ms || b.lastPlayedAt - a.lastPlayedAt),
    topArtists: [...artists.values()].sort((a, b) => b.ms - a.ms || b.plays - a.plays),
    byHour: hours,
    byDay,
    privateExcluded,
  };
}

/** `YYYY-MM-DD` in the listener's own timezone — a UTC day would misreport. */
function localDay(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Distinct entries already present in a stats result, for "N of M" copy. */
export function percentile(count: number, total: number): number {
  return total <= 0 ? 0 : Math.round((count / total) * 100);
}

/** A shareable one-line summary. Deliberately plain — no invented superlatives. */
export function summarise(stats: ListeningStats): string {
  const minutes = Math.round(stats.totalMs / 60_000);
  const top = stats.topArtists[0];
  const parts = [`${minutes.toLocaleString()} minutes across ${stats.plays.toLocaleString()} plays`];
  if (top) parts.push(`most played: ${top.name}`);
  return parts.join(" · ");
}