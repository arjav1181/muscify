"use client";

import { useEffect, useMemo, useState } from "react";
import { trackKey, type Track } from "@/lib/types";

export interface LrcLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface LyricsResult {
  lines: LrcLine[];
  plain: string;
  source: string;
}

/**
 * LRCLIB is the successor to lyrics.ovh — a free, open database of synced
 * lyrics maintained by a community of contributors.
 *
 * Note on licensing: these are community-submitted transcriptions, not licensed
 * lyrics from a rights holder. The public API is fine to use, but if this ever
 * ships to real users, the licensing posture deserves a proper review.
 */
const LRCLIB = "https://lrclib.net/api";

interface LrcbResponse {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

interface LrcbGet {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

/** `[mm:ss.xx]` or `[mm:ss]`, the two forms LRCLIB emits. */
const LRC_TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(input: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const raw of input.split(/\r?\n/)) {
    LRC_TIMESTAMP.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    let consumed = 0;

    // A line can carry several timestamps, e.g. a repeated chorus.
    while ((match = LRC_TIMESTAMP.exec(raw)) !== null) {
      const [, mm, ss, frac] = match;
      const fraction = frac ? Number(`0.${frac}`) : 0;
      stamps.push(Number(mm) * 60 + Number(ss) + fraction);
      consumed = match.index + match[0].length;
    }
    if (!stamps.length) continue;

    const text = raw.slice(consumed).trim();
    if (!text) continue;
    for (const time of stamps) lines.push({ time, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Strip the usual "Artist - Title (feat. X) [Official Video]" noise so the
 * LRCLIB lookup has a real chance of matching.
 */
function cleanTitle(raw: string): { title: string; artist: string } {
  let title = raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^\)]*\)/g, " ")
    .replace(/\bofficial\s*(music\s*)?video\b/gi, " ")
    .replace(/\blyrics?\b/gi, " ")
    .replace(/\b(4k|hd|hq|remaster(ed)?|audio|visualizer|lyric video)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  let artist = "";
  const feat = /\bfeat\.?\s+(.+)$/i.exec(title);
  if (feat) title = title.slice(0, feat.index).trim();

  const parts = title.split(/\s+-\s+/);
  if (parts.length >= 2) {
    artist = parts[0].trim();
    title = parts.slice(1).join(" - ").trim();
  }
  return { title, artist: artist || "" };
}

export function useLyrics(track: Track | null): {
  result: LyricsResult | null;
  loading: boolean;
  error: string | null;
} {
  const [state, setState] = useState<{
    key: string;
    result?: LyricsResult;
    error?: string;
  } | null>(null);

  const key = track?.id ? trackKey(track) : null;
  const eligible = Boolean(track && key && track.source !== "radio");

  useEffect(() => {
    // Radio has no meaningful lyrics — a live stream has no fixed title or
    // length, and nothing to match against.
    if (!track || !key || track.source === "radio") return;

    const controller = new AbortController();
    const requestKey = key;
    const { title, artist } = cleanTitle(track.title);
    const queryArtist = artist || track.artist;

    (async () => {
      try {
        // Prefer the exact-match endpoint: it returns synced lyrics when a
        // transcription exists, and plain text when only that does.
        const params = new URLSearchParams({
          track_name: title,
          artist_name: queryArtist,
          ...(track.album ? { album_name: track.album } : {}),
          ...(track.duration ? { duration: String(Math.round(track.duration)) } : {}),
        });

        const direct = await fetch(`${LRCLIB}/get?${params}`, {
          signal: controller.signal,
        });

        if (direct.ok) {
          const json = (await direct.json()) as LrcbGet;
          if (json.instrumental) {
            setState({ key: requestKey, error: "Instrumental — no lyrics." });
            return;
          }
          const synced = json.syncedLyrics?.trim();
          const plain = json.plainLyrics?.trim() ?? "";
          if (synced || plain) {
            setState({
              key: requestKey,
              result: {
                lines: synced ? parseLrc(synced) : [],
                plain: plain || synced || "",
                source: "LRCLIB",
              },
            });
            return;
          }
        }

        // Fall back to a fuzzy search, then take the best-scoring hit.
        const fuzzy = new URLSearchParams({ q: `${queryArtist} ${title}` });
        const res = await fetch(`${LRCLIB}/search?${fuzzy}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`lyrics lookup failed (${res.status})`);

        const hits = (await res.json()) as LrcbResponse[];
        const best = hits[0];
        if (!best) {
          setState({ key: requestKey, error: "No lyrics found." });
          return;
        }
        const synced = best.syncedLyrics?.trim();
        setState({
          key: requestKey,
          result: {
            lines: synced ? parseLrc(synced) : [],
            plain: best.plainLyrics?.trim() ?? synced ?? "",
            source: "LRCLIB",
          },
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        setState({ key: requestKey, error: e instanceof Error ? e.message : "Lyrics unavailable" });
      }
    })();

    return () => controller.abort();
  }, [key, track]);

  // Results for a superseded track are ignored rather than cleared, so
  // switching tracks never flashes an empty panel. Loading is derived from
  // whether a result for the *current* key has landed.
  const current = state?.key === key ? state : null;
  const loading = eligible && !current;

  return useMemo(
    () => ({
      result: current?.result ?? null,
      error: current?.error ?? null,
      loading,
    }),
    [current?.result, current?.error, loading],
  );
}

/** Index of the active line for a given position, or -1 before the first line. */
export function activeLineIndex(lines: LrcLine[], position: number): number {
  if (!lines.length) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= position) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}