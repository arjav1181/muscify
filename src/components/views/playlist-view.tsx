"use client";

import { useMemo } from "react";
import { ListMusic, Pause, Play, Plus, Shuffle } from "lucide-react";
import type { Track } from "@/lib/types";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";
import { PlaylistArt } from "@/components/track-card";
import { TrackList } from "@/components/track-row";
import { EmptyState } from "@/components/views/library-view";
import { useTrackMenu } from "@/components/track-menu";

export function PlaylistView({ id }: { id: string }) {
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id) ?? null);
  const catalog = useLibrary((s) => s.catalog);
  const removeFrom = useLibrary((s) => s.removeFromPlaylist);
  const reorder = useLibrary((s) => s.reorderPlaylist);
  const addToPlaylist = useLibrary((s) => s.addToPlaylist);
  const openModal = useUi((s) => s.openModal);
  const toast = useUi((s) => s.toast);
  const trackMenu = useTrackMenu();

  const playTracks = usePlayer((s) => s.playTracks);
  const currentTrack = usePlayer((s) => s.queue[s.index] ?? null);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const origin = usePlayer((s) => s.origin);
  const queueLength = usePlayer((s) => s.queue.length);
  const toggle = usePlayer((s) => s.toggle);
  const enqueue = usePlayer((s) => s.enqueue);
  const shuffleOn = usePlayer((s) => s.shuffle);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);

  const tracks = useMemo(
    () =>
      playlist
        ? playlist.items.map((k) => catalog[k]?.track).filter((t): t is Track => Boolean(t))
        : [],
    [playlist, catalog],
  );

  /**
   * The queue only counts as "this playlist" when it was started here and
   * hasn't been reshaped since — otherwise Pause would stop something else.
   */
  const isThisPlaylist =
    origin?.kind === "playlist" && origin.id === id && queueLength === tracks.length;
  const showPause = isThisPlaylist && currentTrack !== null && isPlaying;

  if (!playlist) {
    return (
      <EmptyState
        icon={ListMusic}
        title="Playlist not found"
        body="This playlist may have been deleted."
      />
    );
  }

  const totalSeconds = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);

  return (
    <div className="animate-fade-up">
      <header className="flex flex-col items-start gap-6 md:flex-row md:items-end">
        <PlaylistArt tracks={tracks} name={playlist.name} size="lg" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-sub">Playlist</p>
          <h1 className="mt-2 mb-4 text-4xl font-bold tracking-tight text-on md:text-6xl">
            {playlist.name}
          </h1>
          {playlist.description ? (
            <p className="mb-2 max-w-2xl text-sm text-sub">{playlist.description}</p>
          ) : null}
          <p className="text-sm text-sub">
            <span className="font-semibold text-on">{tracks.length}</span>{" "}
            {tracks.length === 1 ? "song" : "songs"}
            {totalSeconds ? ` · ${formatLongDuration(totalSeconds)}` : ""}
          </p>
        </div>
      </header>

      <div className="my-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (showPause) {
              toggle();
              return;
            }
            playTracks(tracks, 0, { kind: "playlist", id });
          }}
          disabled={!tracks.length}
          aria-label={showPause ? "Pause" : "Play"}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-spotify text-black shadow-lg transition hover:scale-105 disabled:opacity-40"
        >
          {showPause ? (
            <Pause size={24} fill="currentColor" />
          ) : (
            <Play size={24} fill="currentColor" className="translate-x-[1px]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            if (!shuffleOn) toggleShuffle();
            playTracks(tracks, 0, { kind: "playlist", id });
          }}
          disabled={!tracks.length}
          className="flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-sub transition hover:border-on hover:text-on disabled:opacity-40"
        >
          <Shuffle size={16} /> Shuffle
        </button>

        <button
          type="button"
          onClick={() => {
            enqueue(tracks);
            toast(`Added ${tracks.length} songs to the queue`, "success", {
              label: "Show queue",
              run: () => useUi.getState().setQueueOpen(true),
            });
          }}
          disabled={!tracks.length}
          className="flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-sub transition hover:border-on hover:text-on disabled:opacity-40"
        >
          <Plus size={16} /> Add to queue
        </button>

        <button
          type="button"
          onClick={() => openModal({ kind: "edit-playlist", playlistId: id })}
          className="ml-auto rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-sub transition hover:border-on hover:text-on"
        >
          Edit
        </button>
      </div>

      <TrackList
        tracks={tracks}
        onPlayIndex={(i) => playTracks(tracks, i, { kind: "playlist", id })}
        onRemove={(i) => {
          const key = playlist.items[i];
          const removed = tracks[i];
          removeFrom(id, key);
          toast("Removed from playlist", "success", {
            label: "Undo",
            run: () => {
              addToPlaylist(id, [removed], i);
            },
          });
        }}
        onReorder={(from, to) => reorder(id, from, to)}
        onContextMenu={trackMenu}
        emptyLabel="This playlist is empty — search for something and add it."
      />
    </div>
  );
}

function formatLongDuration(totalSeconds: number): string {
  if (!totalSeconds) return "";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours) return `${hours} hr ${minutes} min`;
  return `${minutes} min`;
}