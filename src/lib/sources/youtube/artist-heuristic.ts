/**
 * Judging YouTube channels as artists.
 *
 * YouTube has no artist entity. The Data API's closest thing is the credited
 * artist on a music video, `topicDetails.musicArtistName`, which is populated by
 * its content-identification system rather than by the uploader and is therefore
 * trustworthy. But that only appears on videos the system has identified, so a
 * query can come back with nothing confirmed even for a major artist.
 *
 * When that happens the only thing left is a raw channel search, and a raw
 * channel search is not an artist list. Asked for "pritam" it returns:
 *
 *   Pritam - Topic                     an auto-generated per-track upload channel
 *   Pritam Officeal61                  an impersonator with a typo'd name
 *   Pritam Bhartwan Official Channel   a different person entirely
 *   PRITAM GAMER                        a gaming channel
 *
 * Presenting those as "Artists" is worse than returning nothing: the listener
 * taps the composer and lands on a channel of uploads. So this module exists to
 * decide what, if anything, is honest to show.
 */

/**
 * Auto-generated topic channels are not artists.
 *
 * YouTube creates one per song for the rights-holder's catalogue and names it
 * "{Artist} - Topic". It is an archive of that artist's releases, not a page by
 * that artist, and it is the single most common false positive — "Pritam -
 * Topic" was the first result for "pritam" in production.
 *
 * Matched case-insensitively and on a word boundary, so a real artist called
 * "Topic" is not caught by it.
 */
const TOPIC_SUFFIX = /\s-\s*topic$/i;

/** Channel-name decorations that carry no identifying information. */
const NOISE_SUFFIX = /\s*(\(official\)|\[official\]|official channel|vevo)\s*$/i;

/**
 * Whether a channel name is plausibly a person's or band's name rather than a
 * handle, an upload archive or a topic.
 *
 * This is a heuristic and is treated as one. It exists to keep the obviously
 * wrong rows out, not to decide who is a musician.
 */
export function looksLikeArtistName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;

  // Topic archives are never the artist page.
  if (TOPIC_SUFFIX.test(trimmed)) return false;

  // A handle rather than a name: no spaces, and it isn't a number or a word
  // that is simply written without one.
  if (!/\s/.test(trimmed) && /[_-]/.test(trimmed)) return false;

  // Trailing counters, e.g. "Pritam Officeal61", "Pritam Official2".
  if (/\d+$/.test(trimmed) && !/\b(19|20)\d{2}\b/.test(trimmed)) return false;

  return true;
}

/**
 * Filters raw channel results down to plausible artist pages.
 *
 * Also ranks, because a name that merely *contains* the query is weaker evidence
 * than one that equals it. "Pritam" ranks above "Only Mathematics (by Pritam)"
 * even though both are real.
 */
export function filterArtistCandidates<T extends { title: string }>(
  channels: T[],
  query: string,
): T[] {
  const wanted = query.trim().toLowerCase();
  return channels
    .filter((c) => looksLikeArtistName(c.title))
    .sort((a, b) => {
      const an = a.title.trim().toLowerCase();
      const bn = b.title.trim().toLowerCase();
      const aExact = stripDecoration(an) === wanted ? 0 : 1;
      const bExact = stripDecoration(bn) === wanted ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      // Then shortest first: among near-matches, "Pritam" is likelier to be the
      // artist than "Pritam Official Channel Live Sessions 2024".
      return an.length - bn.length;
    });
}

/** Removes the decorations a channel appends, for equality comparison only. */
function stripDecoration(name: string): string {
  return name
    .replace(NOISE_SUFFIX, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
}