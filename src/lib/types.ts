/** The four playback sources muscify supports. */
export type SourceId = "youtube" | "deezer" | "soundcloud" | "radio";

export type TrackKind = "track" | "video" | "radio" | "playlist" | "album" | "artist";

export interface Track {
  source: SourceId;
  id: string;
  kind?: TrackKind;
  title: string;
  artist: string;
  /** Provider-native artist id, for routing to an artist page. */
  artistId?: string;
  album?: string;
  albumId?: string;
  cover: string;
  /** Seconds. Absent for live streams. */
  duration?: number;
  /** Direct audio stream URL — radio only. */
  stream?: string;
  /** Canonical page URL — SoundCloud embeds only. */
  url?: string;
  /** Playlist id. Playlists play in-engine instead of loading a single video. */
  list?: string;
  year?: string;
  explicit?: boolean;
  /** Popularity metric where the provider exposes one. */
  plays?: number;
  /** Track count for playlists and albums, as reported in search results. */
  itemCount?: number;
}

export interface Station {
  id: string;
  title: string;
  stream: string;
  tags: string;
  image: string;
}

export interface Artist {
  id: string;
  name: string;
  image: string;
  source: SourceId;
  followers?: number;
  verified?: boolean;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  cover: string;
  year?: string;
  source: SourceId;
}

export interface PlaylistSummary {
  id: string;
  title: string;
  cover: string;
  source: SourceId;
  itemCount?: number;
  description?: string;
}

export interface SourceResult<T> {
  results: T[];
  /** Per-source failures, surfaced non-fatally so one dead source can't blank the page. */
  errors: string[];
}

export type BrowseKind =
  | "trending"
  | "charts"
  | "radio"
  | "new-releases"
  | "mood"
  | "get-started"
  | "featured";

export type SourceFilter = "auto" | "youtube" | "deezer";

/** Search result categories, surfaced as filter tabs. */
export type SearchTab =
  | "all"
  | "songs"
  | "videos"
  | "artists"
  | "albums"
  | "playlists"
  | "radio";

export const SOURCE_LABELS: Record<SourceId, string> = {
  youtube: "YouTube",
  deezer: "Deezer",
  soundcloud: "SoundCloud",
  radio: "Radio",
};

/** Stable identity for a track across the catalog, playlists and queue. */
export function trackKey(track: Pick<Track, "source" | "id">): string {
  return `${track.source}:${track.id}`;
}