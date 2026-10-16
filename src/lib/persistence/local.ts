"use client";

import {
  DEFAULT_SETTINGS,
  SNAPSHOT_VERSION,
  emptySnapshot,
  type CatalogEntry,
  type LibrarySnapshot,
  type LibraryRepository,
  type Settings,
} from "./types";

const KEY = "muscify:library:v1";

function probeLocalStorage(): Storage | null {
  try {
    const store = window.localStorage;
    const probe = "__muscify_probe__";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    // Private mode / disabled storage / quota — fall back to memory.
    return null;
  }
}

/**
 * localStorage-backed repository with a transparent in-memory fallback.
 *
 * localStorage is used rather than IndexedDB deliberately: this payload is a
 * few hundred KB at most, it's synchronous to read at boot, and it keeps the
 * whole store hydration story simple. The interface is the seam — moving to
 * IndexedDB or a server means writing a new class, not changing callers.
 */
export class LocalLibraryRepository implements LibraryRepository {
  readonly durable: boolean;
  private storage: Storage | null;
  private memory: LibrarySnapshot = emptySnapshot();

  constructor() {
    this.storage = typeof window === "undefined" ? null : probeLocalStorage();
    this.durable = this.storage !== null;
  }

  async load(): Promise<LibrarySnapshot> {
    if (!this.storage) return structuredClone(this.memory);
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw) return emptySnapshot();
      const parsed = JSON.parse(raw) as LibrarySnapshot;
      if (parsed?.version !== SNAPSHOT_VERSION) {
        // Forward-incompatible or stale — migrate later; for now start clean
        // rather than risk acting on a shape we don't understand.
        return emptySnapshot();
      }
      return normalise(parsed);
    } catch {
      return emptySnapshot();
    }
  }

  async save(snapshot: LibrarySnapshot): Promise<void> {
    if (!this.storage) {
      this.memory = snapshot;
      return;
    }
    try {
      this.storage.setItem(KEY, JSON.stringify(snapshot));
    } catch (e) {
      // Almost always QuotaExceededError. Degrade to memory rather than throw
      // into a React effect; the UI surfaces `durable` for this.
      console.warn("[muscify] persistence failed, continuing in memory", e);
      this.storage = null;
      this.memory = snapshot;
    }
  }

  async clear(): Promise<void> {
    if (this.storage) {
      try {
        this.storage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    }
    this.memory = emptySnapshot();
  }
}

/** Fill in anything a older/partial payload is missing so consumers never guard. */
function normalise(snapshot: LibrarySnapshot): LibrarySnapshot {
  return {
    version: SNAPSHOT_VERSION,
    catalog: snapshot.catalog ?? {},
    playlists: Array.isArray(snapshot.playlists) ? snapshot.playlists : [],
    liked: Array.isArray(snapshot.liked) ? snapshot.liked : [],
    recentlyPlayed: Array.isArray(snapshot.recentlyPlayed) ? snapshot.recentlyPlayed : [],
    followedArtists: Array.isArray(snapshot.followedArtists) ? snapshot.followedArtists : [],
    followedPlaylists: Array.isArray(snapshot.followedPlaylists)
      ? snapshot.followedPlaylists
      : [],
    settings: { ...DEFAULT_SETTINGS, ...(snapshot.settings ?? {}) },
  };
}

/** Drop catalog entries no longer referenced by any playlist, like or history entry. */
export function pruneCatalog(snapshot: LibrarySnapshot): LibrarySnapshot {
  const referenced = new Set<string>();
  for (const p of snapshot.playlists) {
    for (const item of p.items) referenced.add(item);
    if (p.coverKey) referenced.add(p.coverKey);
  }
  for (const l of snapshot.liked) referenced.add(l.key);
  for (const r of snapshot.recentlyPlayed) referenced.add(r.key);

  const catalog: Record<string, CatalogEntry> = {};
  for (const [key, entry] of Object.entries(snapshot.catalog)) {
    if (referenced.has(key)) catalog[key] = entry;
  }
  return { ...snapshot, catalog };
}

export const settingsPatch = (patch: Partial<Settings>): Settings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});