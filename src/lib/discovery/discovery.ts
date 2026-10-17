/**
 * Discovery surfaces built from the local play log.
 *
 * These replace the parts of a recommender that need a server: instead of a
 * trained model over billions of streams, the surfaces here are derived
 * deterministically from what this listener actually played. The trade is
 * real and worth stating — it cannot know about artists you have never played,
 * and it refreshes when *you* listen rather than on a server schedule. What it
 * does have is that it is entirely local and needs no account.
 *
 * All pure. Every function takes a play log plus a catalogue and returns a
 * query or a description; nothing here fetches.
 */

// Relative + explicit extension: the test runner loads this file directly,
// and Node's ESM resolver does not understand the "@/lib" path alias.
import type { PlayEvent } from "../taste/taste.ts";
import { PLAY_THRESHOLD_MS } from "../taste/taste.ts";

/** The metadata a discovery surface needs about one track. */
export interface TrackMeta {
  key: string;
  artist: string;
  album?: string;
  title: string;
  tags?: string[];
  year?: string;
  duration?: number;
}

export interface Catalogue {
  get(key: string): TrackMeta | undefined;
  /** Everything known, for cold-start and breadth queries. */
  all(): TrackMeta[];
}

// ------------------------------------------------------------------ daylist

export interface TimeBucket {
  id: string;
  label: string;
  /** Inclusive start hour, 0..23. */
  from: number;
  to: number;
  /** A short description shown under the daylist title. */
  blurb: string;
}

export const TIME_BUCKETS: TimeBucket[] = [
  { id: "early", label: "Early Morning", from: 5, to: 9, blurb: "A quiet start" },
  { id: "daytime", label: "Daytime", from: 10, to: 16, blurb: "Midday energy" },
  { id: "evening", label: "Evening", from: 17, to: 21, blurb: "Winding down" },
  { id: "late", label: "Late Night", from: 22, to: 4, blurb: "After hours" },
];

export function bucketForHour(hour: number): TimeBucket {
  const h = ((hour % 24) + 24) % 24;
  return (
    TIME_BUCKETS.find((b) => (b.from <= b.to ? h >= b.from && h <= b.to : h >= b.from || h <= b.to)) ??
    TIME_BUCKETS[0]
  );
}

/**
 * Play counts per time bucket.
 *
 * Split on hour-of-day, which is where a daily playlist earns its name — the
 * same artist is a different choice at 7am and at 1am.
 */
export function bucketHistogram(plays: PlayEvent[]): Map<string, number> {
  const histogram = new Map<string, number>();
  for (const play of plays) {
    if (play.private || play.ms < PLAY_THRESHOLD_MS) continue;
    const bucket = bucketForHour(new Date(play.at).getHours());
    histogram.set(bucket.id, (histogram.get(bucket.id) ?? 0) + 1);
  }
  return histogram;
}

/**
 * The listener's peak bucket, or the current one if nothing has been played.
 *
 * Falls back to the clock rather than showing nothing, so a first-run listener
 * still gets a shelf instead of an empty page.
 */
export function activeBucket(plays: PlayEvent[], now = new Date()): TimeBucket {
  const histogram = bucketHistogram(plays);
  let best: TimeBucket | null = null;
  let bestCount = 0;
  for (const bucket of TIME_BUCKETS) {
    const count = histogram.get(bucket.id) ?? 0;
    if (count > bestCount) {
      best = bucket;
      bestCount = count;
    }
  }
  return best ?? bucketForHour(now.getHours());
}

/** Artists ranked by how much this listener plays them in a given bucket. */
export function bucketArtists(
  plays: PlayEvent[],
  catalogue: Catalogue,
  bucketId: string,
  limit = 12,
): { name: string; ms: number }[] {
  const bucket = TIME_BUCKETS.find((b) => b.id === bucketId);
  if (!bucket) return [];

  const totals = new Map<string, number>();
  for (const play of plays) {
    if (play.private || play.ms < PLAY_THRESHOLD_MS) continue;
    const hour = new Date(play.at).getHours();
    const inBucket =
      bucket.from <= bucket.to
        ? hour >= bucket.from && hour <= bucket.to
        : hour >= bucket.from || hour <= bucket.to;
    if (!inBucket) continue;
    const meta = catalogue.get(play.key);
    const artist = meta?.artist ?? "Unknown";
    totals.set(artist, (totals.get(artist) ?? 0) + play.ms);
  }

  return [...totals.entries()]
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit);
}

// ------------------------------------------------------------ taste profile

export interface TasteProfile {
  topArtists: { name: string; ms: number; share: number }[];
  topTags: { tag: string; ms: number }[];
  /** 0..1 — how concentrated listening is on one artist. */
  concentration: number;
  /** Tags the listener has heard least, for a genuine "surprise me" seed. */
  coldTags: string[];
  totalMs: number;
  /** True when there is not enough history to describe anything. */
  cold: boolean;
}

/**
 * A readable summary of what the log actually contains.
 *
 * Deliberately descriptive rather than interpretive: it reports distribution
 * and says nothing about the listener's mood, politics or personality, which
 * is exactly the failure mode the spec warns about when it says taste models
 * should not be treated as objective descriptions of a person.
 */
export function tasteProfile(plays: PlayEvent[], catalogue: Catalogue): TasteProfile {
  const artists = new Map<string, number>();
  const tags = new Map<string, number>();
  let totalMs = 0;

  for (const play of plays) {
    if (play.private || play.ms < PLAY_THRESHOLD_MS) continue;
    totalMs += play.ms;
    const meta = catalogue.get(play.key);
    if (meta) {
      const artist = meta.artist || "Unknown";
      artists.set(artist, (artists.get(artist) ?? 0) + play.ms);
      for (const raw of meta.tags ?? []) {
        for (const tag of raw.split(/[,\-/|]+/)) {
          const clean = tag.trim().toLowerCase();
          // Single characters are noise from tag soup, not a genre.
          if (clean.length < 3) continue;
          tags.set(clean, (tags.get(clean) ?? 0) + play.ms);
        }
      }
    }
  }

  const ranked = [...artists.entries()].sort((a, b) => b[1] - a[1]);
  const topArtists = ranked.slice(0, 10).map(([name, ms]) => ({
    name,
    ms,
    share: totalMs > 0 ? ms / totalMs : 0,
  }));

  const rankedTags = [...tags.entries()].sort((a, b) => b[1] - a[1]);

  // Cold tags: heard, but not enough to be a signature. Used to seed a
  // deliberately unfamiliar shelf.
  const coldTags = rankedTags.filter(([, ms]) => totalMs > 0 && ms / totalMs < 0.01).map(([t]) => t);

  return {
    topArtists,
    topTags: rankedTags.slice(0, 12).map(([tag, ms]) => ({ tag, ms })),
    concentration: topArtists.length && totalMs > 0 ? topArtists[0].ms / totalMs : 0,
    coldTags: coldTags.slice(0, 10),
    totalMs,
    // Roughly a dozen qualifying plays before any claim is worth making.
    cold: plays.filter((p) => !p.private && p.ms >= PLAY_THRESHOLD_MS).length < 12,
  };
}

// ------------------------------------------------------- weekly / rotation

/**
 * A stable rotation seeded by the ISO week.
 *
 * Discover Weekly is refreshed weekly and is the same for a given listener all
 * week, so the seed has to follow real calendar weeks. Elapsed-days-since-Jan-1
 * does not: it anchors to Jan 1st, which can put a Monday and a Friday either
 * side of it in different weeks. ISO-8601 fixes this — weeks start Monday, and
 * week 1 is the week containing the first Thursday.
 *
 * Computed in the listener's own timezone. A UTC week would roll over at a
 * different moment for different people, reshuffling the shelf mid-evening.
 */
export function weeklySeed(now = new Date()): number {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const isoDay = d.getUTCDay() || 7; // Monday=1 … Sunday=7
  d.setUTCDate(d.getUTCDate() + 4 - isoDay); // shift onto this week's Thursday
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  // Fold the ISO year in so week 1 of a new year cannot collide with week 1 of
  // the previous one and repeat that year's shelf.
  return d.getUTCFullYear() * 53 + week;
}

/** Deterministic PRNG so a given seed always yields the same shelf. */
export function seededRandom(seed: number): () => number {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A reproducible sample of the listener's own catalogue.
 *
 * Biased toward what they play most: sampling is weighted by listened time, so
 * a weekly shelf is recognisably theirs rather than uniformly random over
 * everything they have ever touched.
 */
export function weeklyPicks(catalogue: Catalogue, plays: PlayEvent[], now = new Date(), count = 20): TrackMeta[] {
  const affinity = new Map<string, number>();
  for (const play of plays) {
    if (play.private || play.ms < PLAY_THRESHOLD_MS) continue;
    affinity.set(play.key, (affinity.get(play.key) ?? 0) + play.ms);
  }

  const pool = catalogue.all();
  if (pool.length === 0) return [];
  if (pool.length <= count) return pool;

  const random = seededRandom(weeklySeed(now) ^ 0x5bf03635);
  const weighted: { key: string; weight: number }[] = pool.map((track) => ({
    key: track.key,
    // Unplayed tracks still get a floor so cold tracks can appear at all.
    weight: (affinity.get(track.key) ?? 0) + 60_000,
  }));

  const picked: TrackMeta[] = [];
  const taken = new Set<string>();

  // Weighted sampling without replacement.
  for (let n = 0; n < count && taken.size < pool.length; n++) {
    const total = weighted.reduce((sum, w) => (taken.has(w.key) ? sum : sum + w.weight), 0);
    if (total <= 0) break;
    let ticket = random() * total;
    for (const entry of weighted) {
      if (taken.has(entry.key)) continue;
      ticket -= entry.weight;
      if (ticket <= 0) {
        taken.add(entry.key);
        const meta = catalogue.get(entry.key);
        if (meta) picked.push(meta);
        break;
      }
    }
  }

  return picked;
}

// ------------------------------------------------------------ release radar

export interface RadarEntry {
  title: string;
  artist: string;
  year?: string;
  /** Where it came from, so the UI can say so rather than implying Spotify. */
  via: string;
}

/**
 * Recently released albums by artists the listener follows or plays.
 *
 * There is no release-date feed across all four sources, so this is assembled
 * from the year already present in search results for those artists. It is
 * explicitly a radar, not a calendar: a miss means the source did not report a
 * year, not that nothing was released.
 */
export async function releaseRadar(
  artistNames: string[],
  search: (artist: string) => Promise<TrackMeta[]>,
  now = new Date(),
  limit = 12,
): Promise<RadarEntry[]> {
  const currentYear = now.getFullYear();
  const recent = new Set([currentYear, currentYear - 1, currentYear - 2]);

  const results = await Promise.all(
    artistNames.slice(0, 8).map(async (artist) => {
      try {
        return await search(artist);
      } catch {
        // One dead artist must not empty the whole radar.
        return [] as TrackMeta[];
      }
    }),
  );

  const seen = new Set<string>();
  const entries: RadarEntry[] = [];

  for (const group of results) {
    for (const track of group) {
      if (!track.year || !recent.has(Number(track.year))) continue;
      const dedupe = `${track.artist}:${track.album ?? track.title}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      entries.push({ title: track.album ?? track.title, artist: track.artist, year: track.year, via: "album year" });
      if (entries.length >= limit) return entries;
    }
  }

  return entries;
}