/**
 * Cache TTLs per endpoint, chosen against quota cost rather than by habit.
 *
 * `search.list` costs 100 units, so a five-minute TTL would re-buy identical
 * results 288 times a day for the same 10,000 units. These values are about
 * how fast the underlying data actually changes, not how fast a developer
 * expects to see fresh data:
 *
 *  - Search results and the music chart change on the order of days.
 *  - Channel metadata changes rarely at all.
 *
 * The stale window is how long a cached answer may still be served after
 * expiry, but only when upstream has failed. Serving a day-old chart beats
 * showing an error, because a chart that is slightly old is still useful while
 * an empty shelf is not.
 */
export type Ttl = number;

export interface TtlPolicy {
  freshFor: Ttl;
  staleFor: number;
}

export const TTL = {
  /** search.list — 100 units. Results are stable for hours. */
  search: { freshFor: 6 * 3_600_000, staleFor: 24 * 3_600_000 },
  /** Music chart — 100 units, and "most popular" barely moves. */
  chart: { freshFor: 12 * 3_600_000, staleFor: 24 * 3_600_000 },
  /** Channel metadata — 1 unit, but changes almost never. */
  channels: { freshFor: 24 * 3_600_000, staleFor: 7 * 24 * 3_600_000 },
  /** Video detail for a resolved link — 1 unit. */
  videos: { freshFor: 24 * 3_600_000, staleFor: 7 * 24 * 3_600_000 },
  /** Playlist contents — 1 unit, and playlists do change order. */
  playlists: { freshFor: 3_600_000, staleFor: 24 * 3_600_000 },
} as const satisfies Record<string, TtlPolicy>;

export function ttlFor(kind: keyof typeof TTL): Ttl {
  return TTL[kind].freshFor;
}