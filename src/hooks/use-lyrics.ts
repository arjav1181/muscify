"use client";

import { useEffect, useMemo, useState } from "react";
import { trackKey, type Track } from "@/lib/types";
import { looksLikeLabel, parseTitleForArtist, pickBest, readings, scoreHit } from "@/lib/lyrics/match";

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
/**
 * Fetch with one retry.
 *
 * LRCLIB is volunteer-run and rate limits routinely -- a measured run of seven
 * lookups returned three 429s. Retrying once after a pause converts most of
 * those into a hit; without it a lookup that was merely throttled is reported to
 * the listener as "no lyrics found", which is a different and wrong answer.
 */
async function fetchWithRetry(url: string, signal: AbortSignal): Promise<Response> {
  const first = await fetch(url, { signal });
  if (first.ok || first.status !== 429) return first;
  await new Promise((r) => setTimeout(r, 600));
  return fetch(url, { signal });
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
    /*
      The YouTube channel is a label, not a performer -- "T-Series" or
      "Sony Music India" against LRCLIB's artist field matches nothing and
      poisons the fuzzy search too. So the artist is taken from the title, and
      the channel is only consulted when it does not look like a label, which
      for this app's dominant source is never. Both readings of a split title
      are tried below rather than one being guessed.
    */

    (async () => {
      try {
        /*
          Try every reading of the title, exact-match first, then fuzzy.
          
          The same YouTube title can be "Artist - Song", "Song - Artist" or
          "Song | Artist, Featured", and a lyric database files it under exactly
          one of those. Guessing costs a lookup; trying all of them costs at most
          a few and turns "no lyrics found" into a hit. `/get` is tried for every
          reading first because an exact match is the only one that reliably
          carries synced lyrics.
        */
        const parsedTitle = parseTitleForArtist(track.title);
        const channelIsLabel = looksLikeLabel(track.artist);
        const candidates = readings(parsedTitle)
          .map((r) => ({ ...r, artist: r.artist || (channelIsLabel ? "" : track.artist) }))
          .filter((r) => r.title);

        let best: LrcbGet | null = null as LrcbGet | null;
        let bestScore = 0;

        for (const c of candidates) {
          const params = new URLSearchParams({
            track_name: c.title,
            artist_name: c.artist,
            ...(track.album ? { album_name: track.album } : {}),
            ...(track.duration ? { duration: String(Math.round(track.duration)) } : {}),
          });
          const direct = await fetchWithRetry(`${LRCLIB}/get?${params}`, controller.signal);
          if (!direct.ok) continue;
          const json = (await direct.json()) as LrcbGet;
          if (!json.syncedLyrics?.trim() && !json.plainLyrics?.trim()) continue;
          // A synced transcription is worth more than a plain one, so an exact
          // hit with lyrics wins over an exact hit without them.
          if (json.syncedLyrics && !best?.syncedLyrics) best = json;
          else if (!best) best = json;
          break;
        }

        if (best?.instrumental) {
          setState({ key: requestKey, error: "Instrumental — no lyrics." });
          return;
        }
        if (best) {
          const synced = best.syncedLyrics?.trim();
          const plain = best.plainLyrics?.trim() ?? "";
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

        // Nothing exact. Search every reading and keep the best-scoring hit.
        for (const c of candidates) {
          const fuzzy = new URLSearchParams({ q: `${c.artist} ${c.title}`.trim() });
          const res = await fetchWithRetry(`${LRCLIB}/search?${fuzzy}`, controller.signal);
          if (!res.ok) continue;
          const hits = (await res.json()) as LrcbResponse[];
          const pick = pickBest(hits, { title: c.title, artist: c.artist, duration: track.duration });
          if (pick && scoreHit(pick, { title: c.title, artist: c.artist, duration: track.duration }) > bestScore) {
            bestScore = scoreHit(pick, { title: c.title, artist: c.artist, duration: track.duration });
            best = pick as LrcbGet;
          }
          if (bestScore >= 130) break;
        }

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