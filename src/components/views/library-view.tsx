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
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";
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

  return (
    <div className="animate-fade-up pt-6">
      <h2 className="text-2xl font-bold tracking-tight text-on">Your Library</h2>

      <div className="my-5 flex flex-wrap items-center gap-2">
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

      {filter === "playlists" ? <Playlists /> : null}
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

function Playlists() {
  const playlists = useLibrary((s) => s.playlists);
  const openModal = useUi((s) => s.openModal);
  const playTracks = usePlayer((s) => s.playTracks);

  if (!playlists.length) {
    return (
      <EmptyState
        icon={LibraryIcon}
        title="Your library is empty"
        body="Create a playlist to start collecting the music you love."
        action={{ label: "Create playlist", run: () => openModal({ kind: "create-playlist" }) }}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {playlists.map((p) => (
        <PlaylistTile key={p.id} playlist={p} onPlay={() => playTracks([], 0)} />
      ))}
    </div>
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
      className="group relative flex flex-col rounded-card bg-surface p-3 transition-colors hover:bg-highlight"
    >
      <div className="relative mb-4">
        <PlaylistArt tracks={tracks} name={playlist.name} />
        <span className="absolute right-2 bottom-2 flex h-11 w-11 translate-y-2 items-center justify-center rounded-full bg-spotify text-black opacity-0 shadow-xl transition-all group-hover:translate-y-0 group-hover:opacity-100">
          <Play size={16} fill="currentColor" className="translate-x-[1px]" />
        </span>
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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
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
}: {
  icon: typeof Music2;
  title: string;
  body: string;
  action?: { label: string; run: () => void };
}) {
  return (
    <div className="py-16 text-center">
      <Icon size={32} className="mx-auto mb-4 text-dim" />
      <h3 className="mb-2 text-lg font-semibold text-on">{title}</h3>
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