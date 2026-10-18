/**
 * Library ordering.
 *
 * The product spec describes library filters and sort controls under 'Your
 * Library'. Ordering is done here rather than inline so it is testable and so
 * every filter of the same kind — playlists, artists, albums, history — shares
 * one implementation instead of growing its own comparison inline.
 *
 * Pure, and stable: every comparator falls back to a deterministic tiebreak so
 * the order never shuffles between renders, which would make the list feel
 * broken when nothing has changed.
 */

import type { Playlist } from "./persistence/types.ts";

export type LibrarySort =
  | "recently-added"
  | "alphabetical"
  | "creator";

export const LIBRARY_SORTS: { id: LibrarySort; label: string }[] = [
  { id: "recently-added", label: "Recently added" },
  { id: "alphabetical", label: "Name" },
  { id: "creator", label: "Recently updated" },
];

/** Case- and diacritic-insensitive, so "Ä" sorts beside "A". */
function collator(): Intl.Collator {
  return new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
}

/**
 * Orders playlists.
 *
 * "Creator" sorts by last update rather than by author, because there is no
 * author: every playlist here belongs to the one listener. The label says
 * "Recently updated" for that reason.
 */
export function sortPlaylists(playlists: Playlist[], sort: LibrarySort): Playlist[] {
  const items = [...playlists];
  switch (sort) {
    case "alphabetical":
      items.sort((a, b) => collator().compare(a.name, b.name) || a.id.localeCompare(b.id));
      break;
    case "creator":
      items.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
      break;
    default:
      items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }
  return items;
}

/** The generic shape every other library list satisfies. */
export interface Sortable {
  /** Display name, used by the alphabetical order. */
  label: string;
  /** Epoch ms the entry was added. */
  addedAt: number;
  /** Epoch ms of the most recent play, when known. */
  lastPlayedAt?: number;
  /** Play count, used by the most-played order. */
  plays?: number;
  /** Stable tiebreak so equal entries never reorder. */
  id: string;
}

/** History is ordered by recency or by how much was played. */
export type HistorySort = "recent" | "most-played";

export function sortHistory<T extends Sortable>(items: T[], sort: HistorySort): T[] {
  const out = [...items];
  if (sort === "most-played") {
    out.sort(
      (a, b) =>
        (b.plays ?? 0) - (a.plays ?? 0) ||
        (b.lastPlayedAt ?? b.addedAt) - (a.lastPlayedAt ?? a.addedAt) ||
        a.id.localeCompare(b.id),
    );
  } else {
    out.sort(
      (a, b) =>
        (b.lastPlayedAt ?? b.addedAt) - (a.lastPlayedAt ?? a.addedAt) ||
        collator().compare(a.label, b.label),
    );
  }
  return out;
}

/** Artists are ordered by how much was played, then alphabetically. */
export function sortArtists<T extends Sortable>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (b.plays ?? 0) - (a.plays ?? 0) ||
      collator().compare(a.label, b.label) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Filters playlists by a free-text query.
 *
 * Matches name and description. Empty query returns everything, so callers do
 * not need a separate branch.
 */
export function filterPlaylists(playlists: Playlist[], query: string): Playlist[] {
  const q = query.trim().toLowerCase();
  if (!q) return playlists;
  return playlists.filter(
    (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
  );
}