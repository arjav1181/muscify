"use client";

import { useMemo } from "react";
import { Pause, Play } from "lucide-react";
import { artFallback } from "@/lib/art";
import { trackKey, type Track } from "@/lib/types";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";

/**
 * Playlist artwork, Spotify-style: a 4-up mosaic when a playlist has enough
 * tracks with distinct covers, otherwise the first cover, otherwise a hue
 * derived from the name so every playlist looks deliberate.
 */
export function PlaylistArt({
  tracks,
  name,
  size = "md",
}: {
  tracks: Track[];
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const covers = useMemo(() => {
    const seen = new Set<string>();
    for (const t of tracks) {
      if (t.cover && !seen.has(t.cover)) seen.add(t.cover);
      if (seen.size >= 4) break;
    }
    return [...seen];
  }, [tracks]);

  const dimension = size === "lg" ? "h-40 w-40" : size === "sm" ? "h-10 w-10" : "h-28 w-28";

  if (covers.length === 0) {
    return (
      <div
        className={`${dimension} shrink-0 rounded shadow-lg`}
        style={{ background: artFallback({ id: name, title: name }) }}
        aria-hidden
      />
    );
  }

  if (covers.length === 1) {
    return (
      <div className={`${dimension} shrink-0 overflow-hidden rounded shadow-lg`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={covers[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }

  return (
    <div className={`${dimension} grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded bg-black shadow-lg`}>
      {covers.slice(0, 4).map((src) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ))}
    </div>
  );
}

/** Grid card with the hover play affordance and the running equaliser. */
export function TrackCard({
  track,
  index,
  tracks,
}: {
  track: Track;
  index: number;
  /** The list this card belongs to, so clicking plays from the whole context. */
  tracks?: Track[];
}) {
  const context = tracks ?? [track];
  const playTracks = usePlayer((s) => s.playTracks);
  const current = usePlayer((s) => s.queue[s.index] ?? null);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const toggle = usePlayer((s) => s.toggle);

  const isCurrent = Boolean(current && trackKey(current) === trackKey(track));

  const handle = () => {
    // Clicking the playing card toggles transport rather than restarting.
    if (isCurrent) {
      toggle();
      return;
    }
    playTracks(context, index);
  };

  return (
    <article
      onContextMenu={(e) => {
        e.preventDefault();
        useUi.getState().openContextMenu(e.clientX, e.clientY, [
          { label: "Play", run: () => playTracks(context, index) },
          { label: "Play next", run: () => usePlayer.getState().enqueueNext([track]) },
          { label: "Add to queue", run: () => usePlayer.getState().enqueue([track]) },
        ]);
      }}
      className="group relative flex flex-col rounded-card bg-surface p-3 transition-colors hover:bg-highlight"
    >
      <button
        type="button"
        onClick={handle}
        aria-label={`${isCurrent && isPlaying ? "Pause" : "Play"} ${track.title}`}
        className="relative mb-4 block aspect-square w-full overflow-hidden rounded shadow-lg"
        style={{ background: artFallback(track) }}
      >
        {track.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}

        {isCurrent && isPlaying ? (
          <span className="absolute bottom-2 left-2">
            <EqualizerInline />
          </span>
        ) : null}

        <span
          className={`absolute right-2 bottom-2 flex h-11 w-11 translate-y-2 items-center justify-center rounded-full bg-spotify text-black opacity-0 shadow-xl transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 ${
            isCurrent ? "!translate-y-0 !opacity-100" : ""
          }`}
        >
          {isCurrent && isPlaying ? (
            <Pause size={18} fill="currentColor" />
          ) : (
            <Play size={18} fill="currentColor" className="translate-x-[1px]" />
          )}
        </span>
      </button>

      <button type="button" onClick={handle} className="min-w-0 text-left">
        <h3
          className={`truncate text-sm font-semibold ${isCurrent ? "text-spotify" : "text-on"}`}
          title={track.title}
        >
          {track.title}
        </h3>
        <p className="mt-1 line-clamp-2 text-xs text-sub" title={track.artist}>
          {track.artist || "—"}
        </p>
      </button>
    </article>
  );
}

function EqualizerInline() {
  return (
    <span aria-hidden className="flex h-4 w-4 items-end gap-[2px] text-spotify">
      <span className="eq-bar h-full w-[3px] bg-current [animation-delay:-200ms]" />
      <span className="eq-bar h-full w-[3px] bg-current [animation-delay:-600ms]" />
      <span className="eq-bar h-full w-[3px] bg-current [animation-delay:-400ms]" />
    </span>
  );
}

/** Round card used for artists. */
export function ArtistCard({
  artist,
  href,
}: {
  artist: { id: string; name: string; image?: string };
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex flex-col items-center rounded-card bg-surface p-3 text-center transition-colors hover:bg-highlight"
    >
      <div className="mb-4 h-24 w-24 overflow-hidden rounded-full bg-highlight">
        {artist.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artist.image} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : null}
      </div>
      <h3 className="truncate text-sm font-semibold text-on">{artist.name}</h3>
      <p className="mt-1 text-xs text-sub">Artist</p>
    </a>
  );
}

/** Square card used for albums. */
export function AlbumCard({
  album,
  href,
}: {
  album: { id: number | string; title: string; cover?: string; artist?: string };
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex flex-col rounded-card bg-surface p-3 transition-colors hover:bg-highlight"
    >
      <div className="mb-4 aspect-square w-full overflow-hidden rounded shadow-lg bg-highlight">
        {album.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={album.cover} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : null}
      </div>
      <h3 className="truncate text-sm font-semibold text-on">{album.title}</h3>
      <p className="mt-1 truncate text-xs text-sub">{album.artist ?? "—"}</p>
    </a>
  );
}
