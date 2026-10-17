/**
 * Taste signals — the inputs that make recommendations actually personal.
 *
 * Four mechanisms, matching what the product spec describes:
 *
 *   Private Session  Listening is still fully recorded for playback purposes but
 *                    excluded from stats, and the session is not treated as a
 *                    taste signal. This is not "delete history": the tracks
 *                    still show as recently played.
 *   Hide             A track stops appearing in one specific context — a
 *                    playlist, an album, or everywhere. Scoped, because hiding
 *                    a track globally is rarely what someone means.
 *   Snooze           Temporary suppression from recommendations, with an expiry.
 *                    Distinct from Hide: it lapses on its own.
 *   Explicit filter  Refuse explicit tracks before they are queued, rather than
 *                    refusing at playback time.
 *
 * This module is pure. It holds no state and touches no browser APIs so the
 * rules can be tested directly.
 */

/** Where a hide applies. `global` is the terminal case. */
export type HideScope = "global" | string;

export interface HiddenEntry {
  /** `source:id` of the track. */
  key: string;
  /** A context id (playlist/album/station key), or "global". */
  scope: HideScope;
  hiddenAt: number;
}

export interface SnoozedEntry {
  key: string;
  /** Epoch ms after which the track re-enters recommendations. */
  until: number;
  snoozedAt: number;
}

/** Defaults mirror the 30-day control the spec describes. */
export const SNOOZE_DAYS = 30;

export const dayMs = 86_400_000;
export const snoozeMs = SNOOZE_DAYS * dayMs;

export interface PlayEvent {
  key: string;
  at: number;
  /** Milliseconds actually listened, capped at the track length. */
  ms: number;
  /**
   * True when recorded during a Private Session. These stay out of stats and
   * out of taste weighting but remain in recently-played.
   */
  private: boolean;
}

export interface TasteState {
  hidden: HiddenEntry[];
  snoozed: SnoozedEntry[];
  /** Recent listening, newest last. */
  plays: PlayEvent[];
}

export const emptyTasteState = (): TasteState => ({ hidden: [], snoozed: [], plays: [] });

/**
 * Cap on retained play events.
 *
 * Every event is kept individually because time-of-day and daily-series stats
 * need exact timestamps, which an aggregate cannot reconstruct. 2000 events is
 * roughly a month of heavy listening and costs about 120KB of JSON, which sits
 * comfortably inside the localStorage budget alongside the track catalogue.
 */
export const MAX_PLAY_EVENTS = 2000;

/** A track counts as played once it passes this many seconds. */
export const PLAY_THRESHOLD_MS = 30_000;

export function recordPlay(
  state: TasteState,
  event: Omit<PlayEvent, "private">,
  privateSession: boolean,
): TasteState {
  if (event.ms < PLAY_THRESHOLD_MS) return state;

  const plays = [...state.plays, { ...event, private: privateSession }];
  // Trim oldest first; the tail is what stats and weighting actually read.
  if (plays.length > MAX_PLAY_EVENTS) plays.splice(0, plays.length - MAX_PLAY_EVENTS);

  return { ...state, plays };
}

export function hide(state: TasteState, key: string, scope: HideScope = "global", now = Date.now()): TasteState {
  if (state.hidden.some((h) => h.key === key && h.scope === scope)) return state;
  return { ...state, hidden: [...state.hidden, { key, scope, hiddenAt: now }] };
}

export function unhide(state: TasteState, key: string, scope?: HideScope): TasteState {
  return {
    ...state,
    hidden:
      scope === undefined
        ? state.hidden.filter((h) => h.key !== key)
        : state.hidden.filter((h) => !(h.key === key && h.scope === scope)),
  };
}

export function snooze(state: TasteState, key: string, now = Date.now(), ms = snoozeMs): TasteState {
  return {
    ...state,
    snoozed: [
      // Re-snoozing replaces the clock rather than stacking a second entry.
      ...state.snoozed.filter((s) => s.key !== key),
      { key, until: now + ms, snoozedAt: now },
    ],
  };
}

export function unsnooze(state: TasteState, key: string): TasteState {
  return { ...state, snoozed: state.snoozed.filter((s) => s.key !== key) };
}

/** True if `key` is hidden everywhere. */
export function isHiddenGlobally(state: TasteState, key: string): boolean {
  return state.hidden.some((h) => h.key === key && h.scope === "global");
}

/** True if `key` is hidden in the given context, or globally. */
export function isHiddenIn(state: TasteState, key: string, contextId?: string): boolean {
  if (isHiddenGlobally(state, key)) return true;
  if (!contextId) return false;
  return state.hidden.some((h) => h.key === key && h.scope === contextId);
}

/** True while a snooze is still in force. Expired entries never match. */
export function isSnoozed(state: TasteState, key: string, now = Date.now()): boolean {
  const entry = state.snoozed.find((s) => s.key === key);
  return entry !== undefined && entry.until > now;
}

/** Drops snoozes that have lapsed, so the stored list cannot grow unbounded. */
export function pruneSnoozed(state: TasteState, now = Date.now()): TasteState {
  const live = state.snoozed.filter((s) => s.until > now);
  return live.length === state.snoozed.length ? state : { ...state, snoozed: live };
}

export interface FilterOptions {
  /** Playlist/album/station key the results will play inside, if any. */
  contextId?: string;
  /** Skip tracks whose explicit flag is set. */
  excludeExplicit?: boolean;
  /** Epoch ms; pass explicitly in tests. */
  now?: number;
  /** Overrides `explicit`, for sources that do not report the flag. */
  isExplicit?: (key: string) => boolean;
}

/**
 * Applies every suppression rule to a candidate list.
 *
 * Recommendation sources cannot see user taste — they run on the server — so
 * suppression has to happen here, after the results arrive and before they are
 * shown. Suppressed tracks are dropped rather than greyed out, because a greyed
 * row invites the user to click something we already decided against.
 */
export function applyTasteFilter<T extends { key: string; explicit?: boolean }>(
  items: T[],
  state: TasteState,
  opts: FilterOptions = {},
): T[] {
  const now = opts.now ?? Date.now();
  const live = pruneSnoozed(state, now);

  return items.filter((item) => {
    if (isHiddenIn(live, item.key, opts.contextId)) return false;
    if (isSnoozed(live, item.key, now)) return false;
    if (opts.excludeExplicit) {
      const explicit = item.explicit ?? opts.isExplicit?.(item.key) ?? false;
      if (explicit) return false;
    }
    return true;
  });
}

/**
 * Artist keys that should be down-weighted, derived from taste.
 *
 * Repeated non-private listens build an affinity; hiding and snoozing build an
 * aversion. Returned as a signed score per artist so callers can fold it into
 * their own ranking rather than hard-coding a policy here.
 */
export function artistAffinity(state: TasteState, now = Date.now()): Map<string, number> {
  const scores = new Map<string, number>();

  for (const play of state.plays) {
    if (play.private) continue;
    const weight = Math.min(1, play.ms / 180_000);
    scores.set(play.key, (scores.get(play.key) ?? 0) + weight);
  }

  // Live snoozes subtract from whatever the listening earned.
  for (const s of state.snoozed) {
    if (s.until > now) scores.set(s.key, (scores.get(s.key) ?? 0) - 2);
  }
  for (const h of state.hidden) {
    scores.set(h.key, (scores.get(h.key) ?? 0) - 2);
  }

  return scores;
}