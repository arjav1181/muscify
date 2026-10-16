import type { Station } from "@/lib/types";

const CHANNELS = "https://api.somafm.com/channels.json";

/**
 * Used when api.somafm.com is unreachable. These are SomaFM's own published
 * stream URLs — the player still works with zero network discovery. Artwork is
 * left empty so the UI falls back to its deterministic station swatch.
 */
const FALLBACK_STATIONS: Station[] = [
  { id: "groovesalad", title: "Groove Salad", stream: "https://ice1.somafm.com/groovesalad-128-mp3", tags: "chill ambient downtempo relaxing calm lofi", image: "" },
  { id: "beatblender", title: "Beat Blender", stream: "https://ice1.somafm.com/beatblender-128-mp3", tags: "deep house electronic chillout dance", image: "" },
  { id: "dronezone", title: "Drone Zone", stream: "https://ice1.somafm.com/dronezone-128-mp3", tags: "ambient space drone atmospheric", image: "" },
  { id: "secretagent", title: "Secret Agent", stream: "https://ice1.somafm.com/secretagent-128-mp3", tags: "spy lounge retro noir", image: "" },
  { id: "lush", title: "Lush", stream: "https://ice1.somafm.com/lush-128-mp3", tags: "sensual vocals female chillout", image: "" },
  { id: "indiepop", title: "Indie Pop Rocks!", stream: "https://ice1.somafm.com/indiepop-128-mp3", tags: "indie pop rock alternative", image: "" },
  { id: "metal", title: "Metal Detector", stream: "https://ice1.somafm.com/metal-128-mp3", tags: "metal heavy rock", image: "" },
  { id: "defcon", title: "DEF CON Radio", stream: "https://ice1.somafm.com/defcon-128-mp3", tags: "hacker techno coding cyber", image: "" },
  { id: "deepspaceone", title: "Deep Space One", stream: "https://ice1.somafm.com/deepspaceone-128-mp3", tags: "space ambient sci-fi stars", image: "" },
  { id: "seventies", title: "Left Coast 70s", stream: "https://ice1.somafm.com/seventies-128-mp3", tags: "70s classic rock retro oldies", image: "" },
  { id: "fluid", title: "Fluid", stream: "https://ice1.somafm.com/fluid-128-mp3", tags: "instrumental hip-hop jazz beats", image: "" },
  { id: "bootliquor", title: "Boot Liquor", stream: "https://ice1.somafm.com/bootliquor-128-mp3", tags: "americana country roots folk", image: "" },
];

interface SomafmChannel {
  id?: string;
  title?: string;
  genre?: string;
  description?: string;
  image?: string;
  cover?: string;
}

function toStation(ch: SomafmChannel): Station | null {
  if (!ch.id) return null;
  let image = ch.image || ch.cover || "";
  if (image.startsWith("/")) image = `https://somafm.com${image}`;
  return {
    id: ch.id,
    title: ch.title || ch.id,
    stream: directStream(ch.id),
    tags: `${ch.genre ?? ""} ${ch.description ?? ""}`.trim(),
    image,
  };
}

/**
 * SomaFM's channels.json advertises playlists as `.pls` files on api.somafm.com,
 * which are INI playlists — a browser <audio> element can't play one, and
 * fetching 50 of them just to build the directory would be wasteful.
 *
 * The Ice directory exposes the same audio directly at a stable, predictable
 * path, so the stream URL is derived from the channel id instead. Verified
 * across every channel SomaFM currently publishes.
 */
function directStream(id: string): string {
  return `https://ice1.somafm.com/${id}-128-mp3`;
}

/** Full SomaFM channel list, cached for an hour by the fetch cache. */
export async function listStations(): Promise<Station[]> {
  try {
    const res = await fetch(CHANNELS, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { channels?: SomafmChannel[] };
    const stations = (data.channels ?? [])
      .map(toStation)
      .filter((s): s is Station => s !== null);
    if (stations.length) return stations;
  } catch {
    // Fall through to the static list below.
  }
  return FALLBACK_STATIONS;
}

const RADIO_WORDS = new Set(["radio", "station", "stations", "somafm", "stream", "streams", "fm"]);

function words(input: string): Set<string> {
  return new Set(input.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/**
 * Match spoken-style queries against stations.
 *
 * A radio-ish word ("jazz radio") opens tag matching so a genre lands on a
 * station; without one, only distinctive station *names* match — so a plain
 * genre search still reaches the track APIs.
 */
export async function matchStations(query: string): Promise<Station[]> {
  const q = (query ?? "").trim();
  if (!q) return [];
  const qWords = words(q);
  const radioish = [...qWords].some((w) => RADIO_WORDS.has(w));
  const core = new Set([...qWords].filter((w) => !RADIO_WORDS.has(w)));
  const stations = await listStations();

  return stations.filter((st) => {
    if (radioish) {
      const hay = words(`${st.id} ${st.title} ${st.tags}`);
      return [...core].some((w) => hay.has(w));
    }
    const titleWords = words(st.title);
    const nameHit = titleWords.size > 0 && [...titleWords].every((w) => qWords.has(w));
    const distinctive = st.id.length >= 7 && qWords.has(st.id);
    return nameHit || distinctive;
  });
}

/** All stations with the default chill station first, so "next" cycles sensibly. */
export async function rotation(): Promise<Station[]> {
  const stations = await listStations();
  return [...stations].sort((a, b) => Number(b.id === "groovesalad") - Number(a.id === "groovesalad"));
}