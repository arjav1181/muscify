// Relative + explicit extension so `node --test` can load this file directly;
// Node's ESM resolver does not understand the "@/lib" alias.
import { SOURCE_LABELS, type SourceId, type Track } from "./types.ts";

/**
 * Fallback art for sources with no artwork (SoundCloud embeds, Deezer tracks
 * resolved from a bare URL). Deterministic hue per id so the same track always
 * gets the same swatch.
 */
export function artFallback(track: Pick<Track, "id" | "title"> | null): string {
  const seedSource = `${track?.id ?? ""}${track?.title ?? ""}`;
  let hash = 0;
  for (let i = 0; i < seedSource.length; i += 1) {
    hash = (hash * 31 + seedSource.charCodeAt(i)) % 360;
  }
  return `hsl(${hash} 42% 32%)`;
}

export function sourceLabel(source: SourceId): string {
  return SOURCE_LABELS[source];
}

/**
 * Generated station art for streams with no logo.
 *
 * Roughly a third of the radio directory publishes no favicon at all, and a
 * flat colour swatch reads as a broken image rather than a deliberate
 * placeholder. Initials over a two-stop gradient is what radio directories
 * themselves do when a station has no artwork, and it makes the missing logo
 * obviously intentional.
 *
 * Words the stream protocol adds are dropped first, so "Radio City FM" yields
 * "RC" rather than "RCF".
 */
const PROTOCOL_WORDS = /^(radio|fm|am|channel|streaming|live|tv|media|network)$/i;

export function stationInitials(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9\s&-]/g, " ").trim();
  const words = cleaned.split(/[\s&-]+/).filter(Boolean);

  // Drop trailing protocol words first — "Radio City FM" is "Radio City", and
  // the initials should read "RC".
  while (words.length > 1 && PROTOCOL_WORDS.test(words[words.length - 1]!)) words.pop();

  // Then drop interior ones only when enough words survive to identify the
  // station. "BBC Radio 1" should read "B1", but stripping "Radio" out of
  // "Radio City" would leave nothing but "City".
  const kept = words.filter((w, i) => !PROTOCOL_WORDS.test(w) || i >= words.length - 1);
  const final = kept.length >= 2 ? kept : words;

  if (final.length === 0) return "♪";
  if (final.length === 1) {
    const word = final[0]!;
    return (word.length > 1 ? word.slice(0, 2) : word).toUpperCase();
  }
  return (final[0]![0]! + final[1]![0]!).toUpperCase();
}

/**
 * Gradient + text colour for generated station art.
 *
 * The hue comes from the same deterministic hash as {@link artFallback}, so a
 * station always gets the same colours, but lightness and saturation are raised
 * because a gradient carries its own contrast where a single flat fill did not.
 */
export function stationArtStyle(name: string): { background: string; color: string } {
  const seed = `${name}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  const from = `hsl(${hash} 46% 30%)`;
  const to = `hsl(${(hash + 38) % 360} 42% 20%)`;
  return {
    background: `linear-gradient(140deg, ${from}, ${to})`,
    // Light ink on a mid-dark gradient; every hue at these lightnesses clears
    // 4.5:1 against white.
    color: "#f2f2f2",
  };
}