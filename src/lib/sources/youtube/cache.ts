/**
 * YouTube quota-aware cache.
 *
 * YouTube's default quota is 10,000 units/day, and `search.list` costs 100 of
 * them. That is roughly 100 searches before the day's budget is gone, which is
 * why this app hits 429s — and when it does, the whole tab fails rather than
 * degrading.
 *
 * Four things are needed to stop that:
 *
 *   1. Longer TTLs. Next's `revalidate: 300` re-bought the same search results
 *      every five minutes for 100 units each time. Search results and charts
 *      are stable for hours, not minutes.
 *   2. Single-flight. Two requests for the same query arriving together must
 *      cost one call, not two.
 *   3. Stale-on-error. A cached answer beats no answer. When upstream 429s,
 *      the last good response is served and the caller is told it is stale.
 *   4. A quota ledger. Once the budget is gone, stop calling YouTube and say
 *      so, instead of collecting more 429s.
 *
 * The cache is an in-memory Map rather than Next's fetch cache so it survives
 * navigation, and so it can hold stale entries separately from fresh ones.
 * It does not survive a cold start or a new deployment — that is why the
 * underlying fetch still carries a `revalidate`, which lets a cold function
 * warm this cache cheaply rather than paying full price.
 */

import type { Ttl } from "./policy.ts";

/** Quota cost per endpoint, per YouTube's published table. */
export const UNIT_COST = {
  search: 100,
  channels: 1,
  videos: 1,
  playlists: 1,
  playlistItems: 1,
  /**
   * The public-page scraper.
   *
   * Cost 0 and, crucially, **exempt from the budget check** below. It fetches
   * youtube.com's own results page, so it consumes none of the Data API's daily
   * quota -- and it is the thing that exists precisely to keep working when that
   * quota is gone.
   *
   * Booking it as a normal endpoint made the fallback refuse to run for exactly
   * the reason it was written: `canSpend` returned false, the fetch never
   * happened, and a bare `catch` turned the refusal into an empty result list
   * indistinguishable from "YouTube has no results". The fallback was dead
   * precisely when it was needed.
   */
  scrapeSearch: 0,
} as const;

export type Endpoint = keyof typeof UNIT_COST;

/** Endpoints that do not consume Data API quota, so the budget cannot block them. */
const QUOTA_EXEMPT = new Set<Endpoint>(["scrapeSearch"]);

interface Entry<T> {
  value: T;
  storedAt: number;
  /** Kept after expiry so it can still be served when upstream fails. */
  staleValue?: T;
  staleAt?: number;
  /** How long past freshness the stale copy is still worth serving. */
  staleForMs: number;
}

/** In-flight requests, keyed identically to the cache, for single-flight. */
const inflight = new Map<string, Promise<unknown>>();

const store = new Map<string, Entry<unknown>>();

/**
 * Per-unit daily budget.
 *
 * Defaults to 9000 of the 10,000 YouTube grants, leaving headroom so the app
 * cannot take itself over the edge. `search.list` at 100 units means this is
 * about 90 searches/day — which is why the TTLs matter.
 */
const DAILY_BUDGET = UNIT_COST.search * 90;

/** Stale copies stay usable for a day; past that, showing them is worse than admitting failure. */
const STALE_FLOOR_MS = 86_400_000;

export interface QuotaState {
  used: number;
  budget: number;
  /** True once the budget is spent. Further calls are refused, not retried. */
  exhausted: boolean;
  /** Fraction of the budget consumed, 0..1. */
  usedFraction: number;
  resetsAt: number;
}

let quotaUsed = 0;
let quotaDay = "";

function today(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function rolloverIfNeeded(now = Date.now()): void {
  const day = today(now);
  if (day !== quotaDay) {
    quotaDay = day;
    quotaUsed = 0;
  }
}

export function quotaStatus(now = Date.now()): QuotaState {
  rolloverIfNeeded(now);
  return {
    used: quotaUsed,
    budget: DAILY_BUDGET,
    exhausted: quotaUsed >= DAILY_BUDGET,
    usedFraction: Math.min(1, quotaUsed / DAILY_BUDGET),
    // Midnight UTC, when YouTube resets.
    resetsAt: Date.parse(`${today(now)}T00:00:00Z`) + 86_400_000,
  };
}

/** True when a call of this size would exceed the budget. */
export function canSpend(cost: number, now = Date.now()): boolean {
  return quotaStatus(now).used + cost <= quotaStatus(now).budget;
}

/**
 * Errors that mean "ask again later" rather than "this will never work".
 *
 * A 429 or a quota-exceeded 403 should trigger stale-serving; a 400 (bad
 * request) should not, because retrying it will fail identically forever.
 */
export function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|quota|rate.?limit|too many requests/i.test(message);
}

/** The cache key. Order-independent so parameter order cannot fragment it. */
export function cacheKey(endpoint: Endpoint, params: Record<string, string>): string {
  const stable = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `${endpoint}?${stable}`;
}

export interface FetchOutcome<T> {
  value: T;
  /** True when served from cache rather than fetched. */
  cached: boolean;
  /** True when the value is older than its TTL, served because upstream failed. */
  stale: boolean;
}

/**
 * Runs `fetcher` under the cache, the quota ledger and single-flight.
 *
 * `ttl` is how long the value is considered fresh; `staleForMs` is how long
 * past that it may still be served when upstream fails.
 */
export async function cached<T>(
  endpoint: Endpoint,
  params: Record<string, string>,
  ttl: Ttl,
  fetcher: () => Promise<T>,
  now = Date.now(),
): Promise<FetchOutcome<T>> {
  const key = cacheKey(endpoint, params);
  rolloverIfNeeded(now);

  // 1. Fresh hit: no network at all.
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && now - hit.storedAt < ttl) {
    return { value: hit.value, cached: true, stale: false };
  }

  // 2. Single-flight: a concurrent identical request joins the first.
  const existing = inflight.get(key) as Promise<FetchOutcome<T>> | undefined;
  if (existing) return existing;

  const task = (async (): Promise<FetchOutcome<T>> => {
    const cost = UNIT_COST[endpoint];

    // 3. Out of budget: fall back to whatever we last had, or say so.
    //    Quota-exempt endpoints skip this entirely -- see UNIT_COST.
    if (!QUOTA_EXEMPT.has(endpoint) && !canSpend(cost, now)) {
      const staleEntry = hit as Entry<T> | undefined;
      if (staleEntry?.staleValue !== undefined && now - (staleEntry.staleAt ?? 0) < STALE_FLOOR_MS) {
        return { value: staleEntry.staleValue, cached: true, stale: true };
      }
      throw new Error(
        "YouTube daily quota spent — showing other sources until it resets at midnight UTC",
      );
    }

    try {
      const value = await fetcher();
      if (!QUOTA_EXEMPT.has(endpoint)) quotaUsed += cost;

      const previous = store.get(key) as Entry<T> | undefined;
      store.set(key, {
        value,
        storedAt: now,
        // Retain the prior copy as the stale fallback.
        staleValue: value,
        staleAt: now,
        staleForMs: Math.max(ttl, STALE_FLOOR_MS),
      } satisfies Entry<T>);
      void previous;
      return { value, cached: false, stale: false };
    } catch (error) {
      // 4. Upstream refused. Serve stale rather than failing the page.
      if (isQuotaError(error)) {
        const staleEntry = hit as Entry<T> | undefined;
        if (staleEntry && now - (staleEntry.staleAt ?? 0) < STALE_FLOOR_MS) {
          return { value: staleEntry.value, cached: true, stale: true };
        }
      }
      throw error;
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

/** Test seam: drops cached entries and resets the ledger. */
export function resetCache(now = Date.now()): void {
  store.clear();
  inflight.clear();
  quotaUsed = 0;
  quotaDay = today(now);
}

export function cacheSize(): number {
  return store.size;
}