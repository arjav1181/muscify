"use client";

import { AlertTriangle, Check, Loader2, Mic2, Play, Plus, Shuffle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import type { Track } from "@/lib/types";
import { useResource } from "@/hooks/use-resource";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";
import { TrackList } from "@/components/track-row";
import { EmptyState } from "@/components/views/library-view";
import { useTrackMenu } from "@/components/track-menu";

export function ArtistView({ id }: { id: string }) {
  const params = useSearchParams();
  const source = params.get("source") ?? "deezer";

  const { data, loading, error } = useResource(
    `${id}|${source}`,
    async (signal) => {
      const query = new URLSearchParams({ id, source });
      const res = await fetch(`/api/music/artist?${query}`, { signal });
      const json = (await res.json()) as { results?: Track[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Artist failed (${res.status})`);
      return json.results ?? [];
    },
  );

  const playTracks = usePlayer((s) => s.playTracks);
  const enqueue = usePlayer((s) => s.enqueue);
  const shuffleOn = usePlayer((s) => s.shuffle);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const toggleFollowArtist = useLibrary((s) => s.toggleFollowArtist);
  const isFollowing = useLibrary((s) => s.followedArtists.includes(id));
  const toast = useUi((s) => s.toast);
  const trackMenu = useTrackMenu();

  const tracks = data ?? [];
  // Prefer real metadata from the first track over an empty heading.
  const primary = tracks[0];
  const name = primary?.artist || "Artist";

  return (
    <div className="animate-fade-up">
      <header className="flex flex-col items-start gap-6 md:flex-row md:items-end">
        <div className="flex h-44 w-44 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-2xl bg-highlight">
          {primary?.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={primary.cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <Mic2 size={56} className="text-white/30" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-sub">Artist</p>
          <h2 className="mt-2 mb-4 text-4xl font-bold tracking-tight text-on md:text-6xl">
            {name}
          </h2>
          {primary ? (
            <p className="text-sm text-sub">
              {tracks.length} {tracks.length === 1 ? "song" : "songs"}
              {primary.year ? ` · ${primary.year}` : ""}
            </p>
          ) : null}
        </div>
      </header>

      <div className="my-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => playTracks(tracks, 0, { kind: "artist", id })}
          disabled={!tracks.length || loading}
          aria-label="Play"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-spotify text-black shadow-lg transition hover:scale-105 disabled:opacity-40"
        >
          <Play size={24} fill="currentColor" className="translate-x-[1px]" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (!shuffleOn) toggleShuffle();
            playTracks(tracks, 0, { kind: "artist", id });
          }}
          disabled={!tracks.length || loading}
          className="flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-sub transition hover:border-on hover:text-on disabled:opacity-40"
        >
          <Shuffle size={16} /> Shuffle
        </button>
        <button
          type="button"
          onClick={() => {
            toggleFollowArtist(id);
            toast(isFollowing ? `Unfollowed ${name}` : `Following ${name}`, "success");
          }}
          className={`flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold transition ${
            isFollowing
              ? "border-spotify text-spotify"
              : "border-line text-sub hover:border-on hover:text-on"
          }`}
        >
          {isFollowing ? <Check size={16} /> : null}
          {isFollowing ? "Following" : "Follow"}
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

      {loading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-sub">
          <Loader2 size={16} className="animate-spin" /> Loading top tracks…
        </p>
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="Tracks unavailable" body={error} />
      ) : tracks.length ? (
        <TrackList
          tracks={tracks}
          onPlayIndex={(i) => playTracks(tracks, i, { kind: "artist", id })}
          onContextMenu={trackMenu}
        />
      ) : (
        <EmptyState
          icon={Mic2}
          title="No tracks found"
          body="This artist has no playable tracks from your network."
        />
      )}
    </div>
  );
}