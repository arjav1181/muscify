"use client";

import { useMemo } from "react";
import { Download, Heart, Play, Trash2 } from "lucide-react";
import type { Track } from "@/lib/types";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";
import { TrackList } from "@/components/track-row";
import { PlaylistArt } from "@/components/track-card";
import { useTrackMenu } from "@/components/track-menu";

export function LikedSongsView() {
  const liked = useLibrary((s) => s.liked);
  const catalog = useLibrary((s) => s.catalog);
  const clearLiked = useLibrary((s) => s.clearLiked);
  const playTracks = usePlayer((s) => s.playTracks);
  const openModal = useUi((s) => s.openModal);
  const toast = useUi((s) => s.toast);
  const trackMenu = useTrackMenu();
  const enqueue = usePlayer((s) => s.enqueue);

  const tracks = useMemo(
    () => liked.map((l) => catalog[l.key]?.track).filter((t): t is Track => Boolean(t)),
    [liked, catalog],
  );

  const totalMs = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  const duration = formatLongDuration(totalMs);

  if (!tracks.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span
          className="mb-6 flex h-32 w-32 items-center justify-center rounded-full"
          style={{ background: "linear-gradient(135deg,#450af5,#c4efd9)" }}
        >
          <Heart size={48} fill="white" className="text-white" />
        </span>
        <h2 className="mb-2 text-2xl font-bold text-on">Songs you like will appear here</h2>
        <p className="max-w-md text-sm text-sub">
          Save songs by tapping the heart icon.{" "}
          <span className="hidden md:inline">Tip: search for something and press Space to play.</span>
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <header className="flex flex-col items-start gap-6 md:flex-row md:items-end">
        <span
          className="flex h-44 w-44 shrink-0 items-center justify-center rounded shadow-2xl"
          style={{ background: "linear-gradient(135deg,#450af5,#c4efd9)" }}
        >
          <Heart size={72} fill="white" className="text-white" />
        </span>

        <div className="min-w-0">
          <p className="text-sm font-medium text-sub">Playlist</p>
          <h2 className="mt-2 mb-4 text-4xl font-bold tracking-tight text-on md:text-6xl">
            Liked Songs
          </h2>
          <p className="text-sm text-sub">
            <span className="font-semibold text-on">{tracks.length}</span>{" "}
            {tracks.length === 1 ? "song" : "songs"}
            {duration ? ` · ${duration}` : ""}
          </p>
        </div>
      </header>

      <div className="my-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => playTracks(tracks, 0, { kind: "liked", id: "liked" })}
          className="flex items-center gap-2 rounded-full bg-spotify px-6 py-3 text-sm font-semibold text-black transition hover:bg-spotify-dark"
        >
          <Play size={16} fill="currentColor" /> Play
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
          className="flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-sub transition hover:border-on hover:text-on"
        >
          <Download size={15} /> Add to queue
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
          className="flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-sub transition hover:border-on hover:text-on"
        >
          <Trash2 size={15} /> Clear
        </button>
      </div>

      <TrackList
        tracks={tracks}
        onPlayIndex={(i) => playTracks(tracks, i, { kind: "liked", id: "liked" })}
        onContextMenu={trackMenu}
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

export { PlaylistArt };