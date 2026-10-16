import type { RadioRegion, Station } from "@/lib/types";

/**
 * Radio Browser — a free, open, community-maintained directory of internet
 * radio stations with a documented public JSON API. Used for the Indian
 * directory, which SomaFM cannot serve (it is a US-curated selection).
 *
 * This is an API, not scraped HTML: the same access pattern as every other
 * source in this app.
 */

/** Anycast fronts; tried in order so one outage doesn't blank the directory. */
const MIRRORS = [
  "https://de1.api.radio-browser.info",
  "https://de2.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
];

/** Country codes we're willing to serve. Extending this is a one-line change. */
const COUNTRIES: Record<string, RadioRegion> = {
  IN: "india",
};

const MAX_STATIONS = 200;
const FETCH_TIMEOUT = 8000;

/** Codecs a browser can actually play from an Icecast/HTTP stream. */
const PLAYABLE = new Set(["MP3", "AAC", "AACP", "AAC+"]);

interface RbStation {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  codec?: string;
  bitrate?: number;
  votes?: number;
  countrycode?: string;
  language?: string;
  tags?: string;
  image?: string;
  favicon?: string;
}

/**
 * Only HTTPS streams are usable.
 *
 * The app is served over HTTPS, and a browser blocks an `http://` media source
 * as mixed content — ~18% of Radio Browser's Indian listings are plain HTTP
 * and would silently fail to play.
 */
function usable(station: RbStation): boolean {
  const url = station.url_resolved || station.url || "";
  if (!url.startsWith("https://")) return false;
  if (!PLAYABLE.has((station.codec || "").toUpperCase())) return false;
  // Anything under 32kbps is unusably noisy.
  if (station.bitrate !== undefined && station.bitrate > 0 && station.bitrate < 32) return false;
  return true;
}

function toStation(station: RbStation): Station | null {
  const stream = station.url_resolved || station.url || "";
  const id = station.stationuuid;
  if (!id || !stream) return null;

  const language = (station.language || "").split(",")[0].trim().toLowerCase();
  // Genre tags plus language, so the shared search heuristic can match both
  // "bollywood" and "tamil" against this directory too.
  const tags = [station.tags || "", language].filter(Boolean).join(" ");

  return {
    id: `rb:${id}`,
    title: (station.name || "Radio").trim(),
    stream,
    tags,
    image: station.image || station.favicon || "",
    region: COUNTRIES[station.countrycode || ""] ?? "international",
    language: language || undefined,
    bitrate: station.bitrate,
  };
}

async function fetchFrom<T>(path: string, revalidate: number): Promise<T> {
  let lastError: unknown;

  for (const mirror of MIRRORS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(`${mirror}${path}`, {
        signal: controller.signal,
        next: { revalidate },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("all mirrors failed");
}

/**
 * Stations for the given country code, ordered by community votes.
 *
 * Votes are a reasonable proxy for "actually works and people care" — a
 * directory entry with a dead stream and no votes is not worth surfacing.
 */
export async function stationsByCountry(countryCode: string): Promise<Station[]> {
  const path =
    `/json/stations/bycountrycodeexact/${encodeURIComponent(countryCode)}` +
    `?limit=500&hidebroken=true&order=votes&reverse=true`;

  const raw = await fetchFrom<RbStation[]>(path, 6 * 3600);

  const out: Station[] = [];
  for (const entry of raw) {
    if (!usable(entry)) continue;
    const station = toStation(entry);
    if (station) out.push(station);
    if (out.length >= MAX_STATIONS) break;
  }
  return out;
}

/** Every country we're configured to serve, merged. */
export async function directoryStations(): Promise<Station[]> {
  const codes = Object.keys(COUNTRIES);
  const results = await Promise.all(
    codes.map((code) =>
      stationsByCountry(code).catch((e: unknown) => {
        console.warn(`[radio-browser] ${code} unavailable:`, e);
        return [] as Station[];
      }),
    ),
  );
  return results.flat();
}