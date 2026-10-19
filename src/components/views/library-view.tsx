"use client";

import { useMemo, useState } from "react";
import {
  Clock,
  Disc3,
  Heart,
  Library as LibraryIcon,
  ListMusic,
  Mic2,
  Music2,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { artFallback } from "@/lib/art";
import type { Track } from "@/lib/types";
import { FolderBar, moveToFolderItems } from "@/components/folder-bar";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";
import {
  filterPlaylists,
  LIBRARY_SORTS,
  sortPlaylists,
  type LibrarySort,
} from "@/lib/library-sort";
import { ArrowDownAZ, Clock3, MoreHorizontal, Search } from "lucide-react";
import { PlaylistArt } from "@/components/track-card";
import { TrackList } from "@/components/track-row";

type Filter = "playlists" | "liked" | "artists" | "recent" | "albums";

const FILTERS: { id: Filter; label: string; icon: typeof ListMusic }[] = [
  { id: "playlists", label: "Playlists", icon: ListMusic },
  { id: "liked", label: "Liked Songs", icon: Heart },
  { id: "artists", label: "Artists", icon: Mic2 },
  { id: "albums", label: "Albums", icon: Disc3 },
  { id: "recent", label: "Recently Played", icon: Clock },
];

export function LibraryView() {
  const [filter, setFilter] = useState<Filter>("playlists");
  const [sort, setSort] = useState<LibrarySort>("recently-added");
  const [query, setQuery] = useState("");
  // null = every playlist. Folders filter the grid rather than replacing it, so
  // switching is one click and the tiles stay where they were.
  const [folder, setFolder] = useState<string | null>(null);

  return (
    <div className="animate-fade-up pt-6">
      <h1 className="text-2xl font-bold tracking-tight text-on">Your Library</h1>

      {/*
        A named group, not a bare row of buttons. Without this the five filters
        are announced as unrelated controls with no indication they are
        alternatives to each other, and no way to tell which one is active other
        than pressing each in turn.
      */}
      <div
        role="group"
        aria-label="Filter library"
        className="my-5 flex flex-wrap items-center gap-2"
      >
        {FILTERS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === id
                ? "border-on bg-on text-black"
                : "border-line-strong text-sub hover:border-on hover:text-on"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => useUi.getState().openModal({ kind: "create-playlist" })}
          className="ml-auto flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-1.5 text-sm font-medium text-sub transition hover:border-on hover:text-on"
        >
          <Plus size={14} /> Create playlist
        </button>
      </div>

      {/* Sort and filter apply to playlists, artists, albums and history alike. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative flex min-w-[180px] flex-1 items-center sm:max-w-xs">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 text-dim"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter your library"
            aria-label="Filter your library"
            className="w-full rounded-full border border-line-strong bg-base py-2 pr-3 pl-9 text-sm placeholder:text-dim focus:border-white/40 focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2">
          <span className="sr-only">Sort library by</span>
          {sort === "alphabetical" ? (
            <ArrowDownAZ size={14} className="text-dim" aria-hidden />
          ) : (
            <Clock3 size={14} className="text-dim" aria-hidden />
          )}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as LibrarySort)}
            className="rounded-full border border-line-strong bg-base px-3 py-2 text-sm text-sub focus:border-white/40 focus:outline-none"
          >
            {LIBRARY_SORTS.map((option) => (
              <option key={option.id} value={option.id} className="bg-base text-on">
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filter === "playlists" ? (
        <Playlists
          sort={sort}
          query={query}
          folder={folder}
          onFolderChange={setFolder}
        />
      ) : null}
      {filter === "liked" ? <Liked /> : null}
      {filter === "artists" ? <Artists /> : null}
      {filter === "albums" ? <Albums /> : null}
      {filter === "recent" ? <Recent /> : null}
    </div>
  );
}

/** Resolve catalog keys back into tracks, skipping anything pruned. */
function useTracksFor(keys: string[]): Track[] {
  const catalog = useLibrary((s) => s.catalog);
  return useMemo(
    () => keys.map((k) => catalog[k]?.track).filter((t): t is Track => Boolean(t)),
    [keys, catalog],
  );
}

function Playlists({
  sort,
  query,
  folder,
  onFolderChange,
}: {
  sort: LibrarySort;
  query: string;
  folder: string | null;
  onFolderChange: (id: string | null) => void;
}) {
  const all = useLibrary((s) => s.playlists);
  const openModal = useUi((s) => s.openModal);
  const playTracks = usePlayer((s) => s.playTracks);

  // Folder filtering happens after search and sorting, so a folder shows the
  // playlists inside it in the order the listener chose rather than in a
  // different order that would make the shelf look inconsistent.
  const playlists = useMemo(() => {
    const searched = filterPlaylists(all, query);
    const scoped = folder ? searched.filter((p) => p.folderId === folder) : searched;
    return sortPlaylists(scoped, sort);
  }, [all, query, sort, folder]);

  if (!all.length) {
    return (
      <>
        {/* The bar is above the empty state, not below it. Folders before any
            playlist exist is how people set them up -- grouping as you go -- and
            hiding the control until there is something to group means the first
            folder always arrives after the first playlist, which is the wrong
            order. */}
        <FolderBar active={folder} onChange={onFolderChange} />
        <EmptyState
          icon={LibraryIcon}
          headingLevel={2}
          title="Your library is empty"
          body="Create a playlist to start collecting the music you love."
          action={{ label: "Create playlist", run: () => openModal({ kind: "create-playlist" }) }}
        />
      </>
    );
  }

  if (!playlists.length) {
    // Distinguished on purpose: an empty folder is not an empty library, and
    // telling someone their library is empty when it holds thirty playlists
    // because a chip is selected is just wrong.
    const inFolder = folder ? all.filter((p) => p.folderId === folder).length : 0;
    return (
      <div className="py-8">
        <p className="text-sm text-muted">
          {query.trim()
            ? `No playlist matches “${query.trim()}”.`
            : folder && inFolder === 0
              ? "This folder is empty. Move a playlist into it from its ⋯ menu."
              : "No playlists here yet."}
        </p>
        {folder ? (
          <button
            type="button"
            onClick={() => onFolderChange(null)}
            className="mt-3 text-sm font-semibold text-on underline underline-offset-4 hover:text-spotify"
          >
            Show all playlists
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <FolderBar active={folder} onChange={onFolderChange} />
    <div
      role="list"
      aria-label="Playlists"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      {playlists.map((p) => (
        <PlaylistTile key={p.id} playlist={p} onPlay={() => playTracks([], 0)} />
      ))}
    </div>
    </>
  );
}

function PlaylistTile({
  playlist,
  onPlay,
}: {
  playlist: { id: string; name: string; items: string[]; description?: string };
  onPlay: () => void;
}) {
  const coverKey = useLibrary((s) => s.playlists.find((p) => p.id === playlist.id)?.coverKey);
  const cover = useLibrary((s) => (coverKey ? s.catalog[coverKey]?.track.cover : undefined));
  const tracks = useTracksFor(playlist.items);
  void onPlay;

  return (
    <Link
      href={`/playlist/${playlist.id}`}
      role="listitem"
      className="group relative flex flex-col rounded-card bg-surface p-3 transition-colors hover:bg-highlight"
    >
      <div className="relative mb-4">
        <PlaylistArt tracks={tracks} name={playlist.name} />
        <span className="absolute right-2 bottom-2 flex h-11 w-11 translate-y-2 items-center justify-center rounded-full bg-spotify text-black opacity-0 shadow-xl transition-all group-hover:translate-y-0 group-hover:opacity-100">
          <Play size={16} fill="currentColor" className="translate-x-[1px]" />
        </span>
        {/* The play button and the menu occupy the same corner, so the menu is
            the fallback revealed when there is no cover to play from, and a
            hover-revealed control otherwise. */}
        <button
          type="button"
          aria-label={`Options for ${playlist.name}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            useUi.getState().openContextMenu(e.clientX, e.clientY, [
              ...moveToFolderItems(playlist.id),
            ]);
          }}
          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-on opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/80"
        >
          <MoreHorizontal size={15} aria-hidden />
        </button>
      </div>
      <h3 className="truncate text-sm font-semibold text-on">{playlist.name}</h3>
      <p className="mt-1 line-clamp-2 text-xs text-sub">
        {playlist.description || `${playlist.items.length} songs`}
      </p>
      {cover ? null : null}
    </Link>
  );
}

function Liked() {
  const liked = useLibrary((s) => s.liked);
  const playTracks = usePlayer((s) => s.playTracks);
  const reorder = usePlayer((s) => s.reorder);
  const clearLiked = useLibrary((s) => s.clearLiked);
  const openModal = useUi((s) => s.openModal);
  const toast = useUi((s) => s.toast);
  const tracks = useTracksFor(liked.map((l) => l.key));

  if (!tracks.length) {
    return (
      <EmptyState
        icon={Heart}
        title="Nothing liked yet"
        body="Tap the heart on any song to save it here."
      />
    );
  }

  return (
    <>
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => playTracks(tracks, 0, { kind: "liked", id: "liked" })}
          className="flex items-center gap-2 rounded-full bg-spotify px-5 py-2 text-sm font-semibold text-black transition hover:bg-spotify-dark"
        >
          <Play size={15} fill="currentColor" /> Play
        </button>
        <button
          type="button"
          onClick={() =>
            openModal({
              kind: "confirm",
              title: "Remove all liked songs?",
              body: "This clears every song from Liked Songs. It can't be undone.",
              confirmLabel: "Remove all",
              run: () => {
                clearLiked();
                toast("Liked Songs cleared", "success");
              },
            })
          }
          className="flex items-center gap-2 rounded-full border border-line px-5 py-2 text-sm font-semibold text-sub transition hover:border-on hover:text-on"
        >
          <Trash2 size={15} /> Clear
        </button>
      </div>
      <TrackList tracks={tracks} onPlayIndex={(i) => playTracks(tracks, i, { kind: "liked", id: "liked" })} onReorder={reorder} />
    </>
  );
}

function Artists() {
  const followed = useLibrary((s) => s.followedArtists);
  const catalog = useLibrary((s) => s.catalog);
  const toggleFollow = useLibrary((s) => s.toggleFollowArtist);

  // Derive artists from what's actually in the catalog rather than storing a
  // parallel record — one less thing to keep in sync.
  const artists = useMemo(() => {
    const map = new Map<string, { id: string; name: string; image: string; source: string }>();
    for (const entry of Object.values(catalog)) {
      const t = entry.track;
      if (!t.artistId) continue;
      const key = `${t.source}:${t.artistId}`;
      if (map.has(key)) continue;
      map.set(key, { id: t.artistId, name: t.artist, image: "", source: t.source });
    }
    return [...map.values()].filter((a) => !followed.length || followed.includes(a.id));
  }, [catalog, followed]);

  if (!artists.length) {
    return (
      <EmptyState
        icon={Mic2}
        title="No artists yet"
        body="Artists appear here once you play something from them."
      />
    );
  }

  return (
    <div
      role="list"
      aria-label="Artists you follow"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
    >
      {artists.map((a) => (
        <div key={`${a.source}:${a.id}`} className="group relative">
          <Link
            href={`/artist/${encodeURIComponent(a.id)}?source=${a.source}`}
            className="flex flex-col items-center rounded-card bg-surface p-3 text-center transition-colors hover:bg-highlight"
          >
            <div
              className="mb-4 h-24 w-24 rounded-full"
              style={{ background: artFallback({ id: a.id, title: a.name }) }}
            />
            <h3 className="truncate text-sm font-semibold text-on">{a.name}</h3>
            <p className="mt-1 text-xs text-sub">Artist</p>
          </Link>
          <button
            type="button"
            onClick={() => toggleFollow(a.id)}
            className="absolute top-3 right-3 rounded-full bg-black/60 p-1 text-sub opacity-0 transition hover:text-on focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={`Unfollow ${a.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function Albums() {
  const catalog = useLibrary((s) => s.catalog);

  const albums = useMemo(() => {
    const map = new Map<string, { id: string; title: string; cover: string; artist: string; source: string }>();
    for (const entry of Object.values(catalog)) {
      const t = entry.track;
      if (!t.albumId) continue;
      const key = `${t.source}:${t.albumId}`;
      if (map.has(key)) continue;
      map.set(key, {
        id: t.albumId,
        title: t.album || t.title,
        cover: t.cover,
        artist: t.artist,
        source: t.source,
      });
    }
    return [...map.values()];
  }, [catalog]);

  if (!albums.length) {
    return (
      <EmptyState icon={Disc3} title="No albums yet" body="Albums appear here once you play a track from one." />
    );
  }

  return (
    <div
      role="list"
      aria-label="Albums you have played"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
    >
      {albums.map((a) => (
        <Link
          key={`${a.source}:${a.id}`}
          href={`/album/${a.id}?source=${a.source}`}
          className="flex flex-col rounded-card bg-surface p-3 transition-colors hover:bg-highlight"
        >
          <div className="mb-4 aspect-square w-full overflow-hidden rounded bg-highlight">
            {a.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.cover} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : null}
          </div>
          <h3 className="truncate text-sm font-semibold text-on">{a.title}</h3>
          <p className="mt-1 truncate text-xs text-sub">{a.artist}</p>
        </Link>
      ))}
    </div>
  );
}

function Recent() {
  const recent = useLibrary((s) => s.recentlyPlayed);
  const playTracks = usePlayer((s) => s.playTracks);
  const clearHistory = useLibrary((s) => s.clearHistory);
  const openModal = useUi((s) => s.openModal);
  const toast = useUi((s) => s.toast);
  const tracks = useTracksFor(recent.map((r) => r.key));

  if (!tracks.length) {
    return (
      <EmptyState icon={Clock} title="Nothing played yet" body="Songs you play will show up here." />
    );
  }

  return (
    <>
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => playTracks(tracks, 0, { kind: "recent", id: "recent" })}
          className="flex items-center gap-2 rounded-full bg-spotify px-5 py-2 text-sm font-semibold text-black transition hover:bg-spotify-dark"
        >
          <Play size={15} fill="currentColor" /> Play
        </button>
        <button
          type="button"
          onClick={() =>
            openModal({
              kind: "confirm",
              title: "Clear listening history?",
              body: "This removes every entry from Recently Played.",
              confirmLabel: "Clear",
              run: () => {
                clearHistory();
                toast("History cleared", "success");
              },
            })
          }
          className="flex items-center gap-2 rounded-full border border-line px-5 py-2 text-sm font-semibold text-sub transition hover:border-on hover:text-on"
        >
          <Trash2 size={15} /> Clear
        </button>
      </div>
      <TrackList tracks={tracks} onPlayIndex={(i) => playTracks(tracks, i, { kind: "recent", id: "recent" })} />
    </>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  headingLevel = 1,
}: {
  icon: typeof Music2;
  title: string;
  body: string;
  action?: { label: string; run: () => void };
  /**
   * The empty state stands in for the page's content, so its title is the
   * top-level heading by default. Pass 2 when it renders inside a section that
   * already owns an h1.
   */
  headingLevel?: 1 | 2 | 3;
}) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";
  return (
    <div className="py-16 text-center">
      <Icon size={32} className="mx-auto mb-4 text-dim" />
      <Heading className="mb-2 text-lg font-semibold text-on">{title}</Heading>
      <p className="mx-auto mb-6 max-w-sm text-sm text-sub">{body}</p>
      {action ? (
        <button
          type="button"
          onClick={action.run}
          className="rounded-full bg-spotify px-5 py-2 text-sm font-semibold text-black transition hover:bg-spotify-dark"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}