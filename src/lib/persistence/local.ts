"use client";

import {
  DEFAULT_SETTINGS,
  MAX_SEARCH_HISTORY,
  SNAPSHOT_VERSION,
  emptySnapshot,
  seedPlaysFromHistory,
  type CatalogEntry,
  type LibrarySnapshot,
  type LibraryRepository,
  type Settings,
} from "./types.ts";
// Relative rather than via the `@/` alias: this module is imported by the
// sync tests, which run under plain `node --test` and cannot resolve a bundler
// alias.
import { MAX_PLAY_EVENTS, pruneSnoozed, type TasteState } from "../taste/taste.ts";

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
      return migrate(parsed);
    } catch {
      // Unparseable payload: the caller gets a clean install rather than an
      // exception during boot. The old value is left in place so a bug in this
      // file cannot destroy a library it failed to read.
      console.warn("[muscify] library payload unreadable, starting clean");
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

/**
 * Brings any stored payload up to the current shape.
 *
 * v1 payloads are migrated forward rather than discarded. The previous
 * behaviour dropped anything whose version did not match exactly, which meant
 * every schema change silently wiped the listener's playlists and likes — the
 * worst possible failure for a library app. Forward-compatible additions are
 * filled in; only a payload from a *newer* unknown version is refused, because
 * interpreting it could corrupt data written by a later build.
 */
export function migrate(stored: LibrarySnapshot): LibrarySnapshot {
  if (!stored || typeof stored !== "object") return emptySnapshot();

  const version = typeof stored.version === "number" ? stored.version : 1;
  if (version > SNAPSHOT_VERSION) {
    console.warn(
      `[muscify] library written by a newer build (v${version} > v${SNAPSHOT_VERSION}); leaving it untouched`,
    );
    return emptySnapshot();
  }

  const normalised = normalise(stored);

  // v1 → v2: taste signals and search history did not exist. The play log is
  // seeded from the v1 play counter, disclosed as estimates rather than
  // silently invented, and snoozes are pruned so long-dead entries do not
  // accumulate across upgrades.
  if (version < 2) {
    const plays = seedPlaysFromHistory(normalised).slice(-MAX_PLAY_EVENTS);
    normalised.taste = { hidden: [], snoozed: [], plays };
    normalised.searchHistory = [];
  }

  // v2 -> v3: library folders did not exist. `normalise` has already defaulted
  // them to [], so there is nothing to build -- but it is named here so the
  // version bump is a documented step rather than an unexplained number.
  if (version < 3) {
    normalised.folders = [];
  }

  return normalised;
}

/** Fill in anything an older/partial payload is missing so consumers never guard. */
function normalise(snapshot: LibrarySnapshot): LibrarySnapshot {
  const taste: TasteState = {
    hidden: Array.isArray(snapshot.taste?.hidden) ? snapshot.taste.hidden : [],
    snoozed: Array.isArray(snapshot.taste?.snoozed) ? snapshot.taste.snoozed : [],
    plays: Array.isArray(snapshot.taste?.plays) ? snapshot.taste.plays.slice(-MAX_PLAY_EVENTS) : [],
  };
  taste.snoozed = pruneSnoozed(taste).snoozed;

  const history = Array.isArray(snapshot.searchHistory) ? snapshot.searchHistory : [];

  return {
    version: SNAPSHOT_VERSION,
    // Carried through deliberately. This is the sync conflict clock, and
    // dropping it here would make every server copy compare as older than the
    // local one, so a pull would silently never adopt anything.
    updatedAt: typeof snapshot.updatedAt === "number" && Number.isFinite(snapshot.updatedAt)
      ? snapshot.updatedAt
      : 0,
    catalog: snapshot.catalog ?? {},
    playlists: Array.isArray(snapshot.playlists) ? snapshot.playlists : [],
    // Listed explicitly because this function rebuilds the snapshot from named
    // fields. A field missing here does not warn -- it is silently dropped on
    // every single load, which is how `updatedAt` once stopped surviving.
    folders: Array.isArray(snapshot.folders)
      ? snapshot.folders.filter((f) => typeof f?.id === "string" && f.id.length > 0)
      : [],
    liked: Array.isArray(snapshot.liked) ? snapshot.liked : [],
    recentlyPlayed: Array.isArray(snapshot.recentlyPlayed) ? snapshot.recentlyPlayed : [],
    followedArtists: Array.isArray(snapshot.followedArtists) ? snapshot.followedArtists : [],
    followedPlaylists: Array.isArray(snapshot.followedPlaylists)
      ? snapshot.followedPlaylists
      : [],
    settings: { ...DEFAULT_SETTINGS, ...(snapshot.settings ?? {}) },
    taste,
    searchHistory: history
      .filter((h) => typeof h?.query === "string" && h.query.trim().length > 0)
      .slice(0, MAX_SEARCH_HISTORY),
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
  // Taste entries reference tracks too, so pruning them away would leave a
  // hide or snooze pointing at a track that can no longer be resolved.
  for (const h of snapshot.taste.hidden) referenced.add(h.key);
  for (const s of snapshot.taste.snoozed) referenced.add(s.key);
  for (const p of snapshot.taste.plays) referenced.add(p.key);

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