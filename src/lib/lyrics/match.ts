/**
 * Matching a YouTube result to a lyric entry.
 *
 * LRCLIB is the successor to lyrics.ovh: free, open, community-run, and
 * volunteer-hosted. It is also frequently rate limited and occasionally
 * overloaded, so anything that assumes it answers cleanly is wrong.
 *
 * Two problems dominate the hit rate, and neither is about the network:
 *
 *  1. **The artist is usually wrong.** A YouTube `channelTitle` is a *label* --
 *     "T-Series", "Sony Music India", "Zee Music Company" -- and never the
 *     singer. Asking LRCLIB for `artist_name=T-Series` returns nothing, and
 *     poisons the fuzzy search as well. The artist is far more likely to be in
 *     the title, so that is where it is taken from when the channel looks like a
 *     label rather than a person.
 *
 *  2. **The separators are wrong.** YouTube titles use `|`, `_`, `~` and `-` with
 *     wildly inconsistent spacing, and the convention is not always
 *     "artist - song". Splitting on a hyphen alone loses the artist on most
 *     uploads.
 */

/** Channel names that are labels, not performers. */
const LABEL_WORDS =
  /\b(t-?series|sony|music\s*(company|world|india|enterprises)?|zee|venus|times|saregama|marvel\s*music|republic|desi\s*music|s\d\s*music|official\s*music|vevo|kk\s*music|anmol\s*music|ts\s*series|balaji\s*telecom)\b/i;

export function looksLikeLabel(channel: string | undefined): boolean {
  if (!channel) return true;
  return LABEL_WORDS.test(channel);
}

/**
 * Separators seen in real YouTube music titles.
 *
 * ` - ` needs its spaces, because a hyphen inside a word or a date is not a
 * separator. The bare `|` and `_` do not.
 */
const SEPARATORS = /\s+[-–—]\s+|\s*[|~]\s*|\s+[_]\s+|\s+[–—]\s+/;

export interface ParsedTitle {
  /** The song, with marketing noise stripped. */
  title: string;
  /** The artist, or "" when it could not be found. */
  artist: string;
  /**
   * The same two parts, the other way round.
   *
   * "Artist - Song" and "Song - Artist" are both extremely common and the text
   * alone cannot tell them apart. Heuristics tried and rejected: which side is
   * shorter (wrong -- "Kesariya" is short and is the song), whether one side is a
   * label (helps only for labels, not performers). Rather than guess, both
   * readings are offered and the search decides which the database actually has.
   */
  flipped?: { title: string; artist: string };
  /**
   * Primary artist only.
   *
   * "Sapphire | Arijit Singh, Ed Sheeran" is filed in lyric databases under
   * "Arijit Singh" far more often than under the full credit list, so querying
   * the first name alone is a separate shot worth taking.
   */
  primary?: { title: string; artist: string };
}

/** Every reading worth querying, best first. De-duplicated. */
export function readings(parsed: ParsedTitle): { title: string; artist: string }[] {
  const all = [parsed, parsed.flipped, parsed.primary].filter(Boolean) as {
    title: string;
    artist: string;
  }[];
  const seen = new Set<string>();
  const out: { title: string; artist: string }[] = [];
  for (const r of all) {
    const key = `${r.title.toLowerCase()}|${r.artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Pulls an artist out of a title when the channel is a label.
 *
 * Deliberately conservative: it only splits when there are exactly two parts, or
 * when the first part is short enough to plausibly be a person or a band. A
 * three-part title like "Kesariya - Arijit Singh - Pritam" has no single artist
 * in it, and guessing one is worse than returning nothing and letting the search
 * do its job.
 */
export function parseTitleForArtist(raw: string): ParsedTitle {
  let title = raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^\)]*\)/g, " ")
    .replace(/\bofficial\s*(music\s*)?video\b/gi, " ")
    .replace(/\blyric\s*video\b/gi, " ")
    .replace(/\blyrics?\b/gi, " ")
    .replace(/\b(4k|hd|hq|remaster(ed)?|audio|visualizer|full\s*album|song\s*audio)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // `feat.` names a second performer, not the artist the entry is filed under.
  const feat = /\bfeat\.?\s+(.+)$/i.exec(title);
  if (feat) title = title.slice(0, feat.index).trim();

  const parts = title.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);

  if (parts.length >= 2) {
    const a = parts[0].trim();
    const b = parts.slice(1).join(" ").trim();
    // Artist-first is the more common convention, so it leads -- but the other
    // readings are offered too and the caller tries them all.
    const first = b.split(/,|&|\bx\b|\band\b/i)[0].trim();
    return {
      title: b,
      artist: a,
      flipped: { title: a, artist: b },
      primary: { title: a, artist: first },
    };
  }

  return { title, artist: "" };
}

/**
 * Scores a search hit against what was asked for.
 *
 * Taking `hits[0]` is the obvious approach and the wrong one: LRCLIB's search is
 * a loose text match, so the top result for a mangled query can be a different
 * song by the same artist. A track row that silently shows the wrong words is
 * worse than one that says it found nothing.
 *
 * Exact title and artist matches score highest; a duration within a few seconds
 * is a strong confirmation; anything that only shares a word is rejected.
 */
export function scoreHit(
  hit: { trackName?: string; artistName?: string; duration?: number | null; instrumental?: boolean },
  want: { title: string; artist: string; duration?: number },
): number {
  if (hit.instrumental) return -1;

  const norm = (s: string | undefined) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

  const ht = norm(hit.trackName);
  const wt = norm(want.title);
  const ha = norm(hit.artistName);
  const wa = norm(want.artist);

  let score = 0;
  if (wt && ht === wt) score += 100;
  else if (wt && ht && (ht.includes(wt) || wt.includes(ht))) score += 45;
  else if (wt && ht && overlap(ht, wt) > 0.6) score += 25;

  if (wa && ha === wa) score += 60;
  else if (wa && ha && (ha.includes(wa) || wa.includes(ha))) score += 25;
  else if (wa && ha && overlap(ha, wa) > 0.6) score += 10;

  // Duration is the tie-breaker that survives a badly parsed artist, because two
  // songs by one artist with the same name still differ in length.
  if (want.duration && hit.duration) {
    const delta = Math.abs(want.duration - hit.duration);
    if (delta <= 4) score += 30;
    else if (delta <= 12) score += 15;
    else if (delta > 90) score -= 25;
  }

  return score;
}

function overlap(a: string, b: string): number {
  const as = new Set(a.split(" ").filter(Boolean));
  const bs = new Set(b.split(" ").filter(Boolean));
  if (as.size === 0 || bs.size === 0) return 0;
  let shared = 0;
  for (const w of as) if (bs.has(w)) shared++;
  return shared / Math.min(as.size, bs.size);
}

/** Picks the best hit, or null when nothing scores well enough to trust. */
export function pickBest<T extends Parameters<typeof scoreHit>[0]>(
  hits: T[],
  want: Parameters<typeof scoreHit>[1],
  minimum = 25,
): T | null {
  let best: T | null = null;
  let bestScore = minimum;
  for (const hit of hits) {
    const s = scoreHit(hit, want);
    if (s > bestScore) {
      best = hit;
      bestScore = s;
    }
  }
  return best;
}