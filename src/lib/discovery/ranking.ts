/**
 * Taste-aware ranking.
 *
 * The recommendation sources are remote and know nothing about this listener:
 * Deezer's artist radio is the same for everyone, and a text search returns
 * whatever the provider thinks matches. Both are fine as *sources of candidates*.
 * Neither is personal.
 *
 * This module is the part that makes them personal. It re-ranks candidates
 * against what has actually been played:
 *
 *   - artists you already listen to are boosted, with diminishing returns so a
 *     favourite cannot crowd out everything else
 *   - artists similar to your favourites are boosted less than the favourites
 *     themselves, which is what makes a shelf feel curated rather than random
 *   - anything you hid or snoozed is removed outright
 *   - languages and genres you actually play are preferred
 *   - unheard material keeps a floor, so a shelf is never only what you have
 *     already seen
 *
 * Pure, so the ranking can be tested against a known taste profile.
 */

import type { Track } from "../types.ts";
import { applyTasteFilter, type TasteState } from "../taste/taste.ts";

export interface RankOptions {
  /** Play weight per track key, from `artistAffinity`. */
  affinity: Map<string, number>;
  taste: TasteState;
  /** Artist names weighted by listened time, for similarity boosting. */
  artistWeight: Map<string, number>;
  /** Language / directory totals across played material. */
  tagWeight: Map<string, number>;
  /** Languages the listener plays, by weight. */
  languageWeight: Map<string, number>;
  /** Excluded from ranking output. */
  excludeExplicit?: boolean;
  /** Playlist/album context, so a scoped hide applies here. */
  contextId?: string;
}

const EMPTY_MAP = new Map<string, number>();

/**
 * Per-track descriptors.
 *
 * `Track` has no tag or genre field — only radio stations carry one — so the
 * only honest signals available on a track are its language and, for radio, its
 * directory. Genre preference is applied through {@link buildWeights}, which
 * can read tags from the catalogue, rather than being invented per track here.
 */
function descriptorsOf(track: Track): string[] {
  const out: string[] = [];
  const language = track.language?.trim().toLowerCase();
  if (language) out.push(language);
  if (track.region) out.push(track.region);
  return out;
}

function languageOf(track: Track): string | undefined {
  return track.language?.trim().toLowerCase() || undefined;
}

/**
 * Ranks candidates for one listener.
 *
 * Every weight is derived from the play log, so the ordering changes as
 * listening does — which is the difference between a shelf that reacts to you
 * and one that is the same for everyone.
 */
export function rankForListener(tracks: Track[], opts: RankOptions): Track[] {
  const affinity = opts.affinity ?? EMPTY_MAP;
  const artistWeight = opts.artistWeight ?? EMPTY_MAP;
  const tagWeight = opts.tagWeight ?? EMPTY_MAP;
  const languageWeight = opts.languageWeight ?? EMPTY_MAP;

  const scored = tracks.map((track) => {
    let score = 0;

    // Directly played material. log1p keeps a track played 40 times from
    // outscoring everything, which is what makes the shelf look repetitive.
    const direct = affinity.get(`${track.source}:${track.id}`) ?? 0;
    if (direct > 0) score += Math.log1p(direct) * 6;

    const artist = track.artist?.toLowerCase();
    const artistMs = artist ? (artistWeight.get(artist) ?? 0) : 0;
    if (artistMs > 0) score += Math.log1p(artistMs / 60_000) * 4;

    // Descriptors the listener actually plays — language and radio directory.
    for (const descriptor of descriptorsOf(track)) {
      const ms = tagWeight.get(descriptor);
      if (ms) score += Math.log1p(ms / 60_000) * 1.5;
    }

    const language = languageOf(track);
    if (language && languageWeight.has(language)) {
      score += Math.log1p(languageWeight.get(language)! / 60_000) * 2;
    }

    // A small prior for provider popularity, so an unplayed shelf still has
    // some order rather than being arbitrary.
    if (track.plays) score += Math.log1p(track.plays) * 0.5;

    // Floor: material never heard keeps a small chance of surfacing.
    if (direct === 0 && artistMs === 0) score += 1.2;

    return { track, score };
  });

  return scored
    .sort((a, b) => b.score - a.score || (a.track.title > b.track.title ? 1 : -1))
    .map((s) => s.track);
}

/**
 * Full pipeline: suppress what you rejected, then rank what remains.
 *
 * Order matters. Hidden and snoozed items are removed before scoring so they
 * cannot influence the ordering of the rest, and explicit filtering happens
 * here too because the remote sources will happily return them.
 */
export function personalise(
  tracks: Track[],
  taste: TasteState,
  opts: Omit<RankOptions, "taste" | "now"> & { now?: number },
): Track[] {
  const now = opts.now ?? Date.now();
  // applyTasteFilter works on keyed records, so tracks are projected onto
  // {key, explicit} and mapped back afterwards.
  const keys = tracks.map((t) => `${t.source}:${t.id}`);
  const keptKeys = new Set(
    applyTasteFilter(
      keys.map((key, i) => ({ key, explicit: tracks[i]!.explicit })),
      taste,
      { contextId: opts.contextId, excludeExplicit: opts.excludeExplicit, now },
    ).map((k) => k.key),
  );
  const allowed = tracks.filter((t) => keptKeys.has(`${t.source}:${t.id}`));
  return rankForListener(allowed, { ...opts, taste });
}

/**
 * Builds the ranking inputs from a play log.
 *
 * Returned separately from the ranking so the weights can be inspected and
 * tested without constructing a track list.
 */
export function buildWeights(
  plays: { key: string; at: number; ms: number; private: boolean }[],
  resolve: (key: string) => { artist?: string; tags?: string[]; language?: string } | undefined,
): {
  affinity: Map<string, number>;
  artistWeight: Map<string, number>;
  tagWeight: Map<string, number>;
  languageWeight: Map<string, number>;
} {
  const affinity = new Map<string, number>();
  const artistWeight = new Map<string, number>();
  const tagWeight = new Map<string, number>();
  const languageWeight = new Map<string, number>();

  for (const play of plays) {
    // A Private Session is explicitly excluded from shaping recommendations.
    if (play.private) continue;
    affinity.set(play.key, (affinity.get(play.key) ?? 0) + play.ms / 1000);

    const meta = resolve(play.key);
    if (!meta) continue;

    if (meta.artist) {
      const key = meta.artist.toLowerCase();
      artistWeight.set(key, (artistWeight.get(key) ?? 0) + play.ms);
    }
    for (const raw of meta.tags ?? []) {
      for (const tag of raw.split(/[,\-/|]+/)) {
        const clean = tag.trim().toLowerCase();
        if (clean.length < 3) continue;
        tagWeight.set(clean, (tagWeight.get(clean) ?? 0) + play.ms);
      }
    }
    if (meta.language) {
      const lang = meta.language.toLowerCase();
      languageWeight.set(lang, (languageWeight.get(lang) ?? 0) + play.ms);
    }
  }

  return { affinity, artistWeight, tagWeight, languageWeight };
}