"use client";

import { create } from "zustand";
import {
  DEFAULT_SETTINGS,
  emptySnapshot,
  type LibrarySnapshot,
  type LikedEntry,
  type LibraryRepository,
  type Playlist,
  type RecentlyPlayed,
  type Settings,
} from "@/lib/persistence/types";
import { LocalLibraryRepository } from "@/lib/persistence/local";
import { trackKey, type Track } from "@/lib/types";

const MAX_RECENT = 100;
const MAX_CATALOG = 2000;

interface LibraryState {
  ready: boolean;
  durable: boolean;
  catalog: Record<string, LibrarySnapshot["catalog"][string]>;
  playlists: Playlist[];
  liked: LikedEntry[];
  recentlyPlayed: RecentlyPlayed[];
  followedArtists: string[];
  followedPlaylists: string[];
  settings: Settings;

  init: (repo?: LibraryRepository) => Promise<void>;
  reset: () => Promise<void>;

  putTracks: (tracks: Track[]) => void;
  getTrack: (key: string) => Track | null;

  isLiked: (key: string) => boolean;
  toggleLike: (track: Track) => void;
  clearLiked: () => void;

  recordPlay: (track: Track) => void;
  clearHistory: () => void;

  createPlaylist: (name: string, description?: string) => Playlist | null;
  renamePlaylist: (id: string, name: string, description?: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (playlistId: string, tracks: Track[], position?: number) => void;
  removeFromPlaylist: (playlistId: string, key: string) => void;
  reorderPlaylist: (playlistId: string, from: number, to: number) => void;
  getPlaylist: (id: string) => Playlist | null;

  toggleFollowArtist: (artistId: string) => void;
  isFollowingArtist: (artistId: string) => boolean;
  toggleFollowPlaylist: (playlistId: string) => void;

  updateSettings: (patch: Partial<Settings>) => void;
}

/**
 * The user's library: playlists, liked songs, history, follows and settings.
 *
 * State is the single source of truth and is written straight back through the
 * repository on every mutation (debounced to a microtask by the scheduler
 * below). Keeping one store — rather than a store per concern — means a single
 * `save` and no cross-store consistency problem, and the playlist/track
 * relationships stay referentially consistent for free.
 */
export const useLibrary = create<LibraryState>((set, get) => {
  let repo: LibraryRepository = new LocalLibraryRepository();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const snapshot = (): LibrarySnapshot => {
    const s = get();
    return {
      version: 1,
      catalog: s.catalog,
      playlists: s.playlists,
      liked: s.liked,
      recentlyPlayed: s.recentlyPlayed,
      followedArtists: s.followedArtists,
      followedPlaylists: s.followedPlaylists,
      settings: s.settings,
    };
  };

  /**
   * Writes are debounced because history updates fire on every track change and
   * serialising the whole library per change would be wasteful.
   */
  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void repo.save(snapshot());
    }, 250);
  };

  const commit = (partial: Partial<LibraryState>) => {
    set(partial);
    persist();
  };

  const id = () => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  };

  return {
    ready: false,
    durable: true,
    catalog: {},
    playlists: [],
    liked: [],
    recentlyPlayed: [],
    followedArtists: [],
    followedPlaylists: [],
    settings: { ...DEFAULT_SETTINGS },

    init: async (custom) => {
      repo = custom ?? new LocalLibraryRepository();
      const data = await repo.load();
      set({
        ready: true,
        durable: repo.durable,
        catalog: data.catalog,
        playlists: data.playlists,
        liked: data.liked,
        recentlyPlayed: data.recentlyPlayed,
        followedArtists: data.followedArtists,
        followedPlaylists: data.followedPlaylists,
        settings: data.settings,
      });
    },

    reset: async () => {
      await repo.clear();
      const fresh = emptySnapshot();
      set({ ...fresh, ready: true });
    },

    putTracks: (tracks) => {
      if (!tracks.length) return;
      const now = Date.now();
      set((s) => {
        const catalog = { ...s.catalog };
        for (const track of tracks) {
          if (!track?.id) continue;
          catalog[trackKey(track)] = { track, updatedAt: now };
        }
        // Bound memory: evict oldest unreferenced entries once we exceed the cap.
        const keys = Object.keys(catalog);
        if (keys.length > MAX_CATALOG) {
          const referenced = new Set<string>();
          for (const p of s.playlists) p.items.forEach((k) => referenced.add(k));
          s.liked.forEach((l) => referenced.add(l.key));
          const evictable = keys
            .filter((k) => !referenced.has(k))
            .sort((a, b) => catalog[a].updatedAt - catalog[b].updatedAt);
          const excess = keys.length - MAX_CATALOG;
          for (let i = 0; i < Math.min(excess, evictable.length); i += 1) {
            delete catalog[evictable[i]];
          }
        }
        return { catalog };
      });
    },

    getTrack: (key) => get().catalog[key]?.track ?? null,

    isLiked: (key) => get().liked.some((l) => l.key === key),

    toggleLike: (track) => {
      const key = trackKey(track);
      const liked = get().liked;
      const exists = liked.some((l) => l.key === key);
      const next = exists ? liked.filter((l) => l.key !== key) : [{ key, addedAt: Date.now() }, ...liked];
      commit({ liked: next });
      // Ensure the track itself is resolvable from the liked list later.
      if (!exists) get().putTracks([track]);
    },

    clearLiked: () => commit({ liked: [] }),

    recordPlay: (track) => {
      const key = trackKey(track);
      const now = Date.now();
      const existing = get().recentlyPlayed.find((r) => r.key === key);
      const rest = get().recentlyPlayed.filter((r) => r.key !== key);
      const entry: RecentlyPlayed = {
        key,
        playedAt: now,
        playCount: (existing?.playCount ?? 0) + 1,
      };
      commit({ recentlyPlayed: [entry, ...rest].slice(0, MAX_RECENT) });
      get().putTracks([track]);
    },

    clearHistory: () => commit({ recentlyPlayed: [] }),

    createPlaylist: (name, description = "") => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const now = Date.now();
      const playlist: Playlist = {
        id: id(),
        name: trimmed,
        description,
        items: [],
        createdAt: now,
        updatedAt: now,
      };
      commit({ playlists: [playlist, ...get().playlists] });
      return playlist;
    },

    renamePlaylist: (playlistId, name, description) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commit({
        playlists: get().playlists.map((p) =>
          p.id === playlistId
            ? {
                ...p,
                name: trimmed,
                description: description ?? p.description,
                updatedAt: Date.now(),
              }
            : p,
        ),
      });
    },

    deletePlaylist: (playlistId) =>
      commit({ playlists: get().playlists.filter((p) => p.id !== playlistId) }),

    addToPlaylist: (playlistId, tracks, position) => {
      const keys = tracks.filter((t) => t?.id).map(trackKey);
      if (!keys.length) return;
      const now = Date.now();
      commit({
        playlists: get().playlists.map((p) => {
          if (p.id !== playlistId) return p;
          const items = [...p.items];
          // Spotify allows duplicates within a playlist; only follow the
          // requested ordering semantics rather than silently deduping.
          if (position === undefined || position < 0 || position > items.length) {
            items.push(...keys);
          } else {
            items.splice(position, 0, ...keys);
          }
          return { ...p, items, updatedAt: now, coverKey: p.coverKey ?? items[0] };
        }),
      });
      get().putTracks(tracks);
    },

    removeFromPlaylist: (playlistId, key) => {
      commit({
        playlists: get().playlists.map((p) => {
          if (p.id !== playlistId) return p;
          const index = p.items.indexOf(key);
          if (index < 0) return p;
          const items = [...p.items];
          items.splice(index, 1);
          return { ...p, items, updatedAt: Date.now() };
        }),
      });
    },

    reorderPlaylist: (playlistId, from, to) => {
      commit({
        playlists: get().playlists.map((p) => {
          if (p.id !== playlistId) return p;
          if (from < 0 || from >= p.items.length) return p;
          const bounded = Math.max(0, Math.min(p.items.length - 1, to));
          const items = [...p.items];
          const [moved] = items.splice(from, 1);
          items.splice(bounded, 0, moved);
          return { ...p, items, updatedAt: Date.now() };
        }),
      });
    },

    getPlaylist: (playlistId) => get().playlists.find((p) => p.id === playlistId) ?? null,

    toggleFollowArtist: (artistId) => {
      const list = get().followedArtists;
      commit({
        followedArtists: list.includes(artistId)
          ? list.filter((a) => a !== artistId)
          : [...list, artistId],
      });
    },

    isFollowingArtist: (artistId) => get().followedArtists.includes(artistId),

    toggleFollowPlaylist: (playlistId) => {
      const list = get().followedPlaylists;
      commit({
        followedPlaylists: list.includes(playlistId)
          ? list.filter((p) => p !== playlistId)
          : [...list, playlistId],
      });
    },

    updateSettings: (patch) => commit({ settings: { ...get().settings, ...patch } }),
  };
});

/** Resolve playlist items back into Track objects, skipping any pruned entries. */
export function usePlaylistTracks(playlistId: string | null): { tracks: Track[]; missing: number } {
  const playlist = useLibrary((s) => (playlistId ? s.playlists.find((p) => p.id === playlistId) ?? null : null));
  const catalog = useLibrary((s) => s.catalog);

  if (!playlist) return { tracks: [], missing: 0 };
  const tracks: Track[] = [];
  let missing = 0;
  for (const key of playlist.items) {
    const entry = catalog[key];
    if (entry) tracks.push(entry.track);
    else missing += 1;
  }
  return { tracks, missing };
}