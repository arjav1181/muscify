"use client";

import { AlertTriangle, Loader2, Play, Plus, Shuffle } from "lucide-react";
import type { Track } from "@/lib/types";
import { useResource } from "@/hooks/use-resource";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";
import { TrackList } from "@/components/track-row";
import { EmptyState } from "@/components/views/library-view";
import { useTrackMenu } from "@/components/track-menu";

interface AlbumMeta {
  id: number;
  title: string;
  cover: string;
  artist: string;
  releaseDate: string;
  trackCount: number;
}

export function AlbumView({ id }: { id: string }) {
  const { data, loading, error } = useResource(id, async (signal) => {
    const res = await fetch(`/api/music/album?id=${encodeURIComponent(id)}`, { signal });
    const json = (await res.json()) as {
      album?: AlbumMeta;
      tracks?: Track[];
      error?: string;
    };
    if (!res.ok) throw new Error(json.error ?? `Album failed (${res.status})`);
    return { album: json.album ?? null, tracks: json.tracks ?? [] };
  });

  const playTracks = usePlayer((s) => s.playTracks);
  const enqueue = usePlayer((s) => s.enqueue);
  const shuffleOn = usePlayer((s) => s.shuffle);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const toast = useUi((s) => s.toast);
  const trackMenu = useTrackMenu();

  if (loading) {
    return (
      <p className="flex items-center gap-2 pt-6 text-sm text-sub">
        <Loader2 size={16} className="animate-spin" /> Loading album…
      </p>
    );
  }

  if (error || !data?.album) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Album unavailable"
        body={error ?? "Deezer did not return this album from your network."}
      />
    );
  }

  const { album, tracks } = data;
  const year = album.releaseDate ? new Date(album.releaseDate).getFullYear() : null;
  const totalSeconds = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);

  return (
    <div className="animate-fade-up">
      <header className="flex flex-col items-start gap-6 md:flex-row md:items-end">
        <div className="h-44 w-44 shrink-0 overflow-hidden rounded shadow-2xl bg-highlight">
          {album.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={album.cover} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-sub">Album</p>
          <h1 className="mt-2 mb-4 text-4xl font-bold tracking-tight text-on md:text-6xl">
            {album.title}
          </h1>
          <p className="text-sm text-sub">
            <span className="font-semibold text-on">{album.artist}</span>
            {year ? ` · ${year}` : ""} · {tracks.length}{" "}
            {tracks.length === 1 ? "song" : "songs"}
            {totalSeconds ? ` · ${formatLongDuration(totalSeconds)}` : ""}
          </p>
        </div>
      </header>

      <div className="my-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => playTracks(tracks, 0, { kind: "album", id })}
          disabled={!tracks.length}
          aria-label="Play album"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-spotify text-black shadow-lg transition hover:scale-105 disabled:opacity-40"
        >
          <Play size={24} fill="currentColor" className="translate-x-[1px]" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (!shuffleOn) toggleShuffle();
            playTracks(tracks, 0, { kind: "album", id });
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
            toast(`Added ${tracks.length} songs to the queue`, "success");
          }}
          disabled={!tracks.length}
          className="flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-sub transition hover:border-on hover:text-on disabled:opacity-40"
        >
          <Plus size={16} /> Add to queue
        </button>
      </div>

      <TrackList
        tracks={tracks}
        onPlayIndex={(i) => playTracks(tracks, i, { kind: "album", id })}
        onContextMenu={trackMenu}
        emptyLabel="This album has no playable tracks."
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