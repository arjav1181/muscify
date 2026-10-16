import { SOURCE_LABELS, type SourceId, type Track } from "@/lib/types";

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