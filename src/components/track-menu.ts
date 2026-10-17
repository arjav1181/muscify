"use client";

import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { trackKey, type Track } from "@/lib/types";
import { usePlayer } from "@/store/player-store";
import { useLibrary } from "@/store/library-store";
import { useUi, type ContextItem } from "@/store/ui-store";

function sourceUrl(track: Track): string | null {
  if (track.source === "youtube") {
    return track.list
      ? `https://www.youtube.com/playlist?list=${track.list}`
      : `https://www.youtube.com/watch?v=${track.id}`;
  }
  if (track.source === "deezer") return `https://www.deezer.com/track/${track.id}`;
  if (track.source === "soundcloud") return track.url ?? null;
  return track.stream ?? null;
}

/**
 * Builds the submenu for "Add to playlist".
 *
 * Each entry appends the track immediately — no modal, no confirmation —
 * because that's the interaction Spotify uses and a dialog per song is a real
 * tax when you're adding twenty of them.
 */
function playlistItems(track: Track): ContextItem[] {
  const { playlists, createPlaylist, addToPlaylist } = useLibrary.getState();
  const key = trackKey(track);

  const entries: ContextItem[] = playlists.map((p) => ({
    label: p.name,
    run: () => {
      addToPlaylist(p.id, [track]);
      useUi.getState().toast(`Added to ${p.name}`, "success");
    },
  }));

  entries.push({
    label: "New playlist…",
    run: () => {
      const created = createPlaylist(`Playlist ${playlists.length + 1}`);
      if (created) {
        addToPlaylist(created.id, [track]);
        useUi.getState().toast(`Created ${created.name}`, "success");
      }
      void key;
    },
  });

  return entries;
}

/**
 * Returns a handler that opens the Spotify-style right-click menu for a track.
 *
 * Used by rows, cards and queue entries so every surface behaves identically.
 */
export function useTrackMenu() {
  const openContextMenu = useUi((s) => s.openContextMenu);
  const router = useRouter();

  return (event: MouseEvent, track: Track) => {
    event.preventDefault();
    event.stopPropagation();

    const liked = useLibrary.getState().isLiked(trackKey(track));
    const inQueue = usePlayer.getState().queue.some((t) => trackKey(t) === trackKey(track));

    const items: ContextItem[] = [
      { label: "Play", run: () => usePlayer.getState().playTracks([track], 0) },
      { label: "Play next", run: () => usePlayer.getState().enqueueNext([track]) },
      {
        label: "Add to queue",
        disabled: inQueue,
        run: () => usePlayer.getState().enqueue([track]),
      },
      { label: "Add to playlist", children: playlistItems(track) },
      {
        label: liked ? "Remove from Liked Songs" : "Add to Liked Songs",
        run: () => {
          useLibrary.getState().toggleLike(track);
          useUi
            .getState()
            .toast(liked ? "Removed from Liked Songs" : "Added to Liked Songs", "success", {
              label: "Undo",
              run: () => useLibrary.getState().toggleLike(track),
            });
        },
      },
    ];

    if (track.albumId) {
      items.push({
        label: "Go to album",
        run: () => router.push(`/album/${track.albumId}`),
      });
    }
    if (track.artistId) {
      items.push({
        label: "Go to artist",
        run: () =>
          router.push(
            `/artist/${encodeURIComponent(track.artistId!)}?source=${track.source}`,
          ),
      });
    }

    // Taste controls, appended after navigation so the destructive-adjacent
    // actions stay below the harmless ones.
    const lib = useLibrary.getState();
    if (lib.settings.tasteControls) {
      const hidden = lib.isTrackHidden(track);
      const snoozed = lib.isTrackSnoozed(track);
      const toast = useUi.getState().toast;

      items.push({
        label: hidden ? "Unhide song" : "Hide song",
        run: () => {
          if (hidden) lib.unhideTrack(track);
          else lib.hideTrack(track);
          toast(hidden ? "Song unhidden" : "Hidden from recommendations", "success");
        },
      });

      items.push({
        label: snoozed ? "Remove snooze" : "Snooze for 30 days",
        run: () => {
          if (snoozed) lib.unsnoozeTrack(track);
          else lib.snoozeTrack(track);
          toast(
            snoozed ? "Snooze removed" : "Snoozed for 30 days — it will come back",
            "success",
          );
        },
      });
    }

    const href = sourceUrl(track);
    if (href) {
      items.push({
        label: track.source === "radio" ? "Open stream" : "Open on source",
        run: () => window.open(href, "_blank", "noreferrer"),
      });
    }

    openContextMenu(event.clientX, event.clientY, items);
  };
}

export { ContextMenu } from "@/components/context-menu";