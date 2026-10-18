"use client";

import { create } from "zustand";
import {
  DEFAULT_SETTINGS,
  SNAPSHOT_VERSION,
  emptySnapshot,
  type Folder,
  type LibrarySnapshot,
  type LikedEntry,
  type LibraryRepository,
  type Playlist,
  type RecentlyPlayed,
  type SearchEntry,
  type Settings,
} from "@/lib/persistence/types";
import { LocalLibraryRepository } from "@/lib/persistence/local";
import { createRepository, type SyncOutcome } from "@/lib/persistence/sync";
import {
  applyTasteFilter,
  emptyTasteState,
  hide as hideTrackIn,
  isHiddenIn,
  isSnoozed,
  pruneSnoozed,
  recordPlay,
  snooze as snoozeTrackIn,
  unhide as unhideTrackIn,
  unsnooze as unsnoozeTrackIn,
  type PlayEvent,
  type TasteState,
} from "@/lib/taste/taste";
import { trackKey, type Track } from "@/lib/types";

const MAX_RECENT = 100;
const MAX_CATALOG = 2000;

interface LibraryState {
  ready: boolean;
  durable: boolean;
  catalog: Record<string, LibrarySnapshot["catalog"][string]>;
  playlists: Playlist[];
  /** Library folders. See `LibrarySnapshot.folders`.
   */
  folders: Folder[];
  liked: LikedEntry[];
  recentlyPlayed: RecentlyPlayed[];
  followedArtists: string[];
  followedPlaylists: string[];
  settings: Settings;
  /** Hide / snooze / play log. See lib/taste. */
  taste: TasteState;
  /** Most-recent-first search queries. */
  searchHistory: SearchEntry[];

  init: (repo?: LibraryRepository) => Promise<void>;
  reset: () => Promise<void>;

  /**
   * Where the library is currently being kept.
   *
   * Surfaced in Settings. Sync that silently does nothing is indistinguishable
   * from sync that is broken, so the outcome is reported rather than assumed.
   */
  syncStatus: "local" | "syncing" | "synced" | "off" | "unreachable";

  /**
   * Pulls the server copy after boot and adopts it when it is newer.
   *
   * Separate from `init` on purpose: the library must render from local storage
   * immediately, and a network round trip must never sit between the listener
   * and their own playlists.
   */
  sync: () => Promise<LibrarySnapshot | null>;

  /** Records a completed listen for stats and taste weighting. */
  notePlay: (track: Track, ms: number) => void;
  /** `scope` defaults to "global"; pass a playlist/album key to scope it. */
  hideTrack: (track: Track, scope?: string) => void;
  unhideTrack: (track: Track, scope?: string) => void;
  snoozeTrack: (track: Track, days?: number) => void;
  unsnoozeTrack: (track: Track) => void;
  pruneTaste: () => void;
  noteSearch: (query: string) => void;
  clearSearchHistory: () => void;

  /** True when the track is hidden here or globally. */
  isTrackHidden: (track: Track, contextId?: string) => boolean;
  /** True while a snooze is in force. */
  isTrackSnoozed: (track: Track) => boolean;
  /**
   * Applies hide/snooze/explicit rules to a candidate list.
   *
   * Takes tracks rather than `{key}` records because that is what every caller
   * has; the key is derived here so no caller can pass a mismatched one.
   */
  filterByTaste: (tracks: Track[], contextId?: string) => Track[];
  /** Raw play log, oldest first. Private events included but flagged. */
  playEvents: () => PlayEvent[];

  putTracks: (tracks: Track[]) => void;
  getTrack: (key: string) => Track | null;

  isLiked: (key: string) => boolean;
  toggleLike: (track: Track) => void;
  clearLiked: () => void;

  recordPlay: (track: Track) => void;
  clearHistory: () => void;

  createFolder: (name: string) => Folder | null;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  moveToFolder: (playlistId: string, folderId: string | null) => void;
  getFolder: (id: string) => Folder | null;

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
      version: SNAPSHOT_VERSION,
      catalog: s.catalog,
      playlists: s.playlists,
      folders: s.folders,
      liked: s.liked,
      recentlyPlayed: s.recentlyPlayed,
      followedArtists: s.followedArtists,
      followedPlaylists: s.followedPlaylists,
      settings: s.settings,
      taste: s.taste,
      searchHistory: s.searchHistory,
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
    syncStatus: "local",
    catalog: {},
    playlists: [],
    liked: [],
    recentlyPlayed: [],
    followedArtists: [],
    followedPlaylists: [],
    settings: { ...DEFAULT_SETTINGS },
    taste: emptyTasteState(),
    searchHistory: [],
    folders: [],

    init: async (custom) => {
      repo = custom ?? createRepository();
      const data = await repo.load();
      set({
        ready: true,
        durable: repo.durable,
        catalog: data.catalog,
        playlists: data.playlists,
        folders: data.folders,
        liked: data.liked,
        recentlyPlayed: data.recentlyPlayed,
        followedArtists: data.followedArtists,
        followedPlaylists: data.followedPlaylists,
        settings: data.settings,
        taste: data.taste,
        searchHistory: data.searchHistory,
      });
    },

    /**
     * Adopts a newer server copy, if there is one.
     *
     * `pull` is optional on the interface — local storage has nothing to pull —
     * so a repository without it resolves immediately and costs nothing.
     *
     * The snapshot is applied through `set` rather than by reloading, so an
     * adopted library does not send the user back through `ready` and a flash of
     * empty views.
     */
    sync: async () => {
      const pullable = repo as LibraryRepository & {
        pull?: () => Promise<SyncOutcome>;
      };
      if (typeof pullable.pull !== "function") return null;

      set({ syncStatus: "syncing" });
      const outcome = await pullable.pull();

      if (outcome.status !== "synced") {
        set({
          syncStatus: outcome.status,
          durable: repo.durable,
        });
        return null;
      }

      const remote = outcome.snapshot;
      if (!remote) {
        set({ syncStatus: "synced", durable: repo.durable });
        return null;
      }

      set({
        catalog: remote.catalog,
        playlists: remote.playlists,
        folders: remote.folders,
        liked: remote.liked,
        recentlyPlayed: remote.recentlyPlayed,
        followedArtists: remote.followedArtists,
        followedPlaylists: remote.followedPlaylists,
        settings: remote.settings,
        taste: remote.taste,
        searchHistory: remote.searchHistory,
        durable: repo.durable,
        syncStatus: "synced",
      });
      return remote;
    },

    reset: async () => {
      await repo.clear();
      const fresh = emptySnapshot();
      set({ ...fresh, ready: true });
    },

    // ------------------------------------------------------------- taste

    /**
     * Records a completed listen.
     *
     * Called once per track when playback ends or the listener moves on, with
     * the time actually spent on the track. Short skips are discarded by
     * `recordPlay`, so this is safe to call unconditionally.
     */
    notePlay: (track: Track, ms: number) => {
      const key = trackKey(track);
      const s = get();
      commit({ taste: recordPlay(s.taste, { key, at: Date.now(), ms }, s.settings.privateSession) });
    },

    hideTrack: (track: Track, scope = "global") => {
      commit({ taste: hideTrackIn(get().taste, trackKey(track), scope) });
    },

    unhideTrack: (track: Track, scope?: string) => {
      commit({ taste: unhideTrackIn(get().taste, trackKey(track), scope) });
    },

    snoozeTrack: (track: Track, days = 30) => {
      commit({
        taste: snoozeTrackIn(get().taste, trackKey(track), Date.now(), days * 86_400_000),
      });
    },

    unsnoozeTrack: (track: Track) => {
      commit({ taste: unsnoozeTrackIn(get().taste, trackKey(track)) });
    },

    /** Clears expired snoozes so the stored list cannot grow without bound. */
    pruneTaste: () => {
      const s = get();
      const next = pruneSnoozed(s.taste);
      if (next.snoozed.length !== s.taste.snoozed.length) commit({ taste: next });
    },

    // ------------------------------------------------------------ search

    /**
     * Records a submitted query, bumping an existing entry rather than
     * appending a duplicate, and keeping the list most-recent-first.
     */
    noteSearch: (query: string) => {
      const trimmed = query.trim().slice(0, 80);
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      const s = get();
      const existing = s.searchHistory.find((h) => h.query.toLowerCase() === key);
      const rest = s.searchHistory.filter((h) => h.query.toLowerCase() !== key);
      const entry: SearchEntry = {
        query: trimmed,
        at: Date.now(),
        count: (existing?.count ?? 0) + 1,
      };
      const searchHistory = [entry, ...rest].sort((a, b) => b.at - a.at).slice(0, 12);
      commit({ searchHistory });
    },

    clearSearchHistory: () => commit({ searchHistory: [] }),

    isTrackHidden: (track, contextId) => isHiddenIn(get().taste, trackKey(track), contextId),

    isTrackSnoozed: (track) => isSnoozed(get().taste, trackKey(track)),

    filterByTaste: (tracks, contextId) => {
      const s = get();
      // Sources do not carry the explicit flag for every track, so fall back
      // to whatever the local catalogue already knows about it.
      const known = (key: string) => s.catalog[key]?.track.explicit === true;
      return applyTasteFilter(
        tracks.map((track) => ({ key: trackKey(track), explicit: track.explicit })),
        s.taste,
        { contextId, excludeExplicit: s.settings.excludeExplicit, isExplicit: known },
      ).map((kept) => tracks.find((t) => trackKey(t) === kept.key)!);
    },

    playEvents: () => get().taste.plays,

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

    createFolder: (name) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const now = Date.now();
      const folder: Folder = { id: id(), name: trimmed, createdAt: now, updatedAt: now };
      commit({ folders: [...get().folders, folder] });
      return folder;
    },

    renameFolder: (folderId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commit({
        folders: get().folders.map((f) =>
          f.id === folderId ? { ...f, name: trimmed, updatedAt: Date.now() } : f,
        ),
      });
    },

    /*
      Deleting a folder never deletes anything inside it.
      
      The playlists it held simply lose their `folderId` and return to the
      uncategorised shelf. Deleting them as well would mean a gesture aimed at
      organising a library destroyed the library, which is the one outcome a
      folder feature must never produce.
    */
    deleteFolder: (folderId) =>
      commit({
        folders: get().folders.filter((f) => f.id !== folderId),
        playlists: get().playlists.map((p) =>
          p.folderId === folderId ? { ...p, folderId: undefined } : p,
        ),
      }),

    moveToFolder: (playlistId, folderId) => {
      const playlists = get().playlists;
      const target = playlists.find((p) => p.id === playlistId);
      if (!target) return;
      // Ignore a move to a folder that does not exist rather than writing a
      // dangling id: a playlist referencing a missing folder would vanish from
      // every shelf at once, with no way to get it back.
      if (folderId && !get().folders.some((f) => f.id === folderId)) return;

      commit({
        playlists: playlists.map((p) =>
          p.id === playlistId ? { ...p, folderId: folderId ?? undefined, updatedAt: Date.now() } : p,
        ),
      });
    },

    getFolder: (folderId) => get().folders.find((f) => f.id === folderId) ?? null,

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