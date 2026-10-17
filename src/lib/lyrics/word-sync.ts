/**
 * Word-level timing derived from line-level sync.
 *
 * The spec asks for lyrics that progress with playback. LRCLIB supplies line
 * timestamps; it advertises a `hasWordSync` flag but does not populate word
 * timing on the transcripts it serves, so genuine forced alignment is not
 * available from any free source. Spotify's `/audio-analysis` is gone.
 *
 * This interpolates instead. Each line's known duration is divided across its
 * words in proportion to their length, which produces a karaoke-style sweep
 * that re-anchors on every line. The important property is that error cannot
 * accumulate: whatever is wrong about a word's position is corrected at the
 * start of the next line, rather than drifting across the song the way a
 * globally-fitted tempo would.
 *
 * It is an approximation and the UI labels it as one.
 */

/** One word with its start and end, in seconds from the start of the track. */
export interface WordTiming {
  word: string;
  start: number;
  end: number;
  /** Index of the line this word belongs to. */
  lineIndex: number;
}

/** Lines as they arrive from `parseLrc`. */
export interface TimedLine {
  time: number;
  text: string;
}

/** Minimum gap so a word is visible for long enough to read. */
const MIN_WORD_SECONDS = 0.12;

/** Longest assumed word duration, so a long line cannot leave the last word hanging. */
const MAX_WORD_SECONDS = 1.4;

/**
 * Splits a line into words, keeping punctuation attached.
 *
 * Trailing punctuation stays with its word so "you," renders as one token
 * rather than a stray comma.
 */
export function splitWords(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/).filter(Boolean);
}

/**
 * Distributes one line's span across its words.
 *
 * Weighting by character count approximates syllable count closely enough for
 * a highlight, and costs nothing. Purely proportional distribution would drift
 * on lines of very uneven word length, so each weight gets a floor to stop a
 * one-character word disappearing entirely.
 */
export function interpolateWords(
  line: TimedLine,
  lineIndex: number,
  nextTime: number | null,
): WordTiming[] {
  const words = splitWords(line.text);
  if (words.length === 0) return [];

  // Without a following line we cannot know where this one ends, so assume a
  // typical line rather than extending to infinity.
  const span = nextTime !== null ? Math.max(0, nextTime - line.time) : 4;
  const capped = Math.min(span, words.length * MAX_WORD_SECONDS);

  const weights = words.map((w) => Math.max(1, w.replace(/[^\p{L}\p{N}]/gu, "").length || 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const proportional = weights.map((w) => (w / totalWeight) * capped);

  // Flooring every word at MIN_WORD_SECONDS is only possible when the span can
  // pay for it. Enforcing it unconditionally would push the line past its end
  // and, on a long dense line, squeeze the tail into sub-frame durations.
  const needed = words.length * MIN_WORD_SECONDS;
  let durations: number[];
  if (needed <= capped) {
    // Every word gets the floor; the spare time is shared out by weight.
    const spare = capped - needed;
    durations = proportional.map((d) => MIN_WORD_SECONDS + (d / capped) * spare);
  } else {
    durations = proportional;
  }

  const timings: WordTiming[] = [];
  let cursor = line.time;
  for (let i = 0; i < words.length; i++) {
    const duration = durations[i]!;
    // A word with no time would never be reachable; drop it rather than
    // emitting a highlight that can never fire.
    if (duration <= 0.001) continue;
    timings.push({ word: words[i]!, start: cursor, end: cursor + duration, lineIndex });
    cursor += duration;
  }

  return timings;
}

/**
 * Word timings for a whole track.
 *
 * `lines` must be sorted by time, which is what `parseLrc` guarantees.
 */
export function buildWordTimings(lines: TimedLine[]): WordTiming[] {
  if (lines.length === 0) return [];
  const out: WordTiming[] = [];
  for (let i = 0; i < lines.length; i++) {
    const next = i + 1 < lines.length ? lines[i + 1]!.time : null;
    out.push(...interpolateWords(lines[i]!, i, next));
  }
  return out;
}

/** Index of the word active at `position`, or -1 when between words. */
export function activeWordIndex(timings: WordTiming[], position: number): number {
  if (!timings.length) return -1;
  let lo = 0;
  let hi = timings.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timings[mid]!.start <= position) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found === -1) return -1;
  // A gap between lines reads as no active word rather than a stale highlight.
  return position <= timings[found]!.end ? found : -1;
}

/**
 * Formats a span for display: `62%` of the way through the active word.
 *
 * Drives the fill on the highlighted word so the sweep advances smoothly
 * instead of jumping word to word.
 */
export function wordProgress(timing: WordTiming, position: number): number {
  const span = timing.end - timing.start;
  if (span <= 0) return 1;
  const pct = (position - timing.start) / span;
  return pct < 0 ? 0 : pct > 1 ? 1 : pct;
}