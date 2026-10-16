import type { RadioRegion, Station, Track } from "@/lib/types";
import { directoryStations } from "./radio-browser";
import { listStations as somafmStations } from "./somafm";

/**
 * The full radio directory, across every source.
 *
 * Sources are merged rather than replacing one another: SomaFM is a curated
 * US selection and Radio Browser carries the Indian listings, so the two are
 * complementary. Each is resolved independently and a failure degrades to the
 * other rather than blanking the page.
 */
export async function allStations(): Promise<{
  stations: Station[];
  errors: string[];
}> {
  const [international, directory] = await Promise.all([
    somafmStations().catch((e: unknown) => {
      console.warn("[radio] SomaFM unavailable:", e);
      return [] as Station[];
    }),
    directoryStations(),
  ]);

  const errors: string[] = [];
  if (!international.length) errors.push("SomaFM directory unavailable");

  // Dedupe by stream URL in case two directories ever overlap.
  const seen = new Set<string>();
  const stations = [...international, ...directory].filter((s) => {
    if (seen.has(s.stream)) return false;
    seen.add(s.stream);
    return true;
  });

  return { stations, errors };
}

/**
 * Rank stations against a free-text query.
 *
 * Scored rather than gated: a hit on the station *name* outranks a hit on its
 * genre tags or language, so "mirchi" surfaces Radio Mirchi first while "tamil"
 * still returns the Tamil-language stations.
 *
 * The original JARVIS player used a stricter radio-word heuristic, where a bare
 * word only matched distinctive station names — that existed so a spoken "play
 * metal" fell through to the music search instead of hitting "Metal Detector".
 * With no voice router, an explicit station search should behave like search.
 */
function words(input: string): Set<string> {
  return new Set(input.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

export function matchStationsIn(
  query: string,
  stations: Station[],
  region?: RadioRegion,
): Station[] {
  const q = (query ?? "").trim();
  if (!q) return [];

  const pool = region ? stations.filter((s) => s.region === region) : stations;
  const qWords = words(q);

  const scored: { station: Station; score: number }[] = [];

  for (const station of pool) {
    const nameWords = words(station.title);
    const haystack = words(
      `${station.id} ${station.title} ${station.tags} ${station.language ?? ""}`,
    );

    let score = 0;
    for (const w of qWords) {
      if (nameWords.has(w)) score += 4;
      else if (haystack.has(w)) score += 1;
    }
    // Matching every query word somewhere is a stronger signal than a partial
    // match, so nudge partial hits down without dropping them.
    if (score > 0 && qWords.size > 1 && score < qWords.size * 2) score -= 0.5;

    if (score > 0) scored.push({ station, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.station.title.localeCompare(b.station.title))
    .map((s) => s.station);
}

export function stationToTrack(st: {
  id: string;
  title: string;
  stream: string;
  image: string;
  region: RadioRegion;
  language?: string;
}): Track {
  return {
    source: "radio",
    id: st.id,
    title: st.title,
    artist: st.region === "india" ? "Indian Radio" : "SomaFM Radio",
    cover: st.image,
    stream: st.stream,
    region: st.region,
    language: st.language,
  };
}

/** Languages present in a directory slice, ordered by station count. */
export function languagesIn(stations: Station[]): { language: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of stations) {
    const lang = s.language?.trim().toLowerCase();
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
}