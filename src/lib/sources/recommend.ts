import type { Track } from "@/lib/types";
import { stationToTrack } from "./radio";
import type { Station } from "@/lib/types";
import { searchDeezer } from "./deezer";
import { hasYoutubeKey, searchYoutube } from "./youtube";

/**
 * Recommendations.
 *
 * Spotify's recommendations are collaborative-filtering over billions of
 * streams — that dataset only exists inside Spotify, and nothing can recreate
 * it. What *is* available here is genuinely useful and honest: Deezer's
 * editorial similarity graph (artists and their curated artist radio), plus the
 * rich genre/language tagging on the radio directories.
 *
 * Every strategy degrades independently, so a failure narrows the result rather
 * than blanking the page.
 */

export interface RecommendationSet {
  /** Named `results` to match every other endpoint in this API. */
  results: Track[];
  errors: string[];
  /** Which strategy actually produced the result — surfaced in the UI so the
   *  recommendation isn't dressed up as something it isn't. */
  strategy: "artist-radio" | "search" | "station-seed" | "none";
}

/** Curated mood shelves — the keyless half of the Discover page. */
export interface MoodShelf {
  id: string;
  title: string;
  subtitle: string;
  query: string;
  emoji: string;
}

export const MOODS: MoodShelf[] = [
  { id: "chill", title: "Chill", subtitle: "Unwind", query: "chill lofi beats relax", emoji: "🌙" },
  { id: "energy", title: "Energy", subtitle: "Get moving", query: "workout motivation hits", emoji: "⚡" },
  { id: "focus", title: "Focus", subtitle: "Deep work", query: "instrumental focus concentration", emoji: "🎯" },
  { id: "party", title: "Party", subtitle: "Turn it up", query: "party dance hits", emoji: "🎉" },
  { id: "bollywood", title: "Bollywood", subtitle: "Filmi favourites", query: "bollywood hits", emoji: "🎬" },
  { id: "punjabi", title: "Punjabi", subtitle: "Punjabi hits", query: "punjabi songs", emoji: "🪕" },
  { id: "hindi", title: "Hindi", subtitle: "Hindi classics", query: "hindi top 40 songs", emoji: "🎵" },
  { id: "retro", title: "Retro", subtitle: "Nostalgia", query: "90s hits throwback", emoji: "📼" },
  { id: "morning", title: "Morning", subtitle: "Easy start", query: "morning coffee acoustic", emoji: "☕" },
  { id: "late", title: "Late night", subtitle: "After hours", query: "late night r&b vibes", emoji: "🌃" },
  { id: "desi", title: "Desi", subtitle: "Regional Indian", query: "hindi punjabi tamil hits", emoji: "🪔" },
  { id: "workout", title: "Cardio", subtitle: "Tempo up", query: "running cardio hits", emoji: "🏃" },
];

/**
 * Tracks similar to a seed track.
 *
 * Preference order: the seed's Deezer artist radio (a curated, human-shaped
 * station for that artist), falling back to a text search built from the
 * artist/title/album. The search path is what makes this work for YouTube
 * tracks, which carry no Deezer artist id.
 */
export async function seededTracks(seed: {
  source: Track["source"];
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
}): Promise<RecommendationSet> {
  const errors: string[] = [];

  if (seed.artistId) {
    try {
      const { deezerArtistRadio } = await import("./deezer");
      const tracks = await deezerArtistRadio(Number(seed.artistId), 25);
      if (tracks.length) return { results: tracks, errors, strategy: "artist-radio" };
    } catch (e) {
      errors.push(`artist radio: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Text fallback: the artist is the strongest signal, so lead with it.
  const query = [seed.artist, seed.album].filter(Boolean).join(" ") || seed.title;

  try {
    const results: Track[] = [];
    if (hasYoutubeKey()) {
      try {
        results.push(...(await searchYoutube(query, 15)));
      } catch (e) {
        errors.push(`youtube: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    try {
      results.push(...(await searchDeezer(query, 15)));
    } catch (e) {
      errors.push(`deezer: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (results.length) return { results, errors, strategy: "search" };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  return { results: [], errors, strategy: "none" };
}

export interface RelatedArtist {
  id: string;
  name: string;
  image: string;
  followers: number;
}

/** Similar artists, from Deezer's editorial similarity graph. */
export async function relatedArtists(artistId: string): Promise<{
  artists: RelatedArtist[];
  errors: string[];
}> {
  if (!/^\d+$/.test(artistId)) return { artists: [], errors: [] };
  try {
    const { deezerRelatedArtists } = await import("./deezer");
    const found = await deezerRelatedArtists(Number(artistId), 12);
    return {
      artists: found.map((a) => ({
        id: String(a.id),
        name: a.name,
        image: a.picture,
        followers: a.followers,
      })),
      errors: [],
    };
  } catch (e) {
    return {
      artists: [],
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
}

/**
 * "More like this station."
 *
 * Radio stations carry genre and language tags, so the station's own metadata
 * becomes a search query. It's the recommendation that works with no API key
 * at all, which makes it the most reliable of the three.
 */
export async function stationSeededTracks(
  station: Station,
  limit = 20,
): Promise<RecommendationSet> {
  const seed = (station.language || station.tags || "")
    .split(/\s+/)
    .filter((w: string) => w.length > 2 && w !== "radio")
    .slice(0, 3)
    .join(" ");

  const errors: string[] = [];

  // A station with no tags gives us nothing to search with; say so rather than
  // returning an empty shelf that looks like "no matches".
  if (!seed) {
    errors.push(`${station.title} has no genre or language tags to seed from`);
    return { results: [], errors, strategy: "none" };
  }

  const tracks: Track[] = [];

  if (hasYoutubeKey()) {
    try {
      tracks.push(...(await searchYoutube(`${seed} music`, 12)));
    } catch (e) {
      errors.push(`youtube: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    tracks.push(...(await searchDeezer(seed, 12)));
  } catch (e) {
    errors.push(`deezer: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    results: tracks.slice(0, limit),
    errors,
    strategy: tracks.length ? "station-seed" : "none",
  };
}

export { stationToTrack };