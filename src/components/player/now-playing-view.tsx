"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Heart,
  ListMusic,
  Maximize2,
  Minimize2,
  MoreHorizontal,
} from "lucide-react";
import {
  ARTWORK_FALLBACK_BG,
  extractArtworkColour,
  type ArtworkColour,
} from "@/lib/artwork-colour";
import { artFallback } from "@/lib/art";
import { trackKey } from "@/lib/types";
import { usePlayer } from "@/store/player-store";
import { useLibrary } from "@/store/library-store";
import { useUi } from "@/store/ui-store";
import { useTrackMenu } from "@/components/track-menu";
import { PlaybackControls } from "@/components/player/playback-controls";
import { ProgressBar } from "@/components/player/progress-bar";

/**
 * Full-screen Now Playing.
 *
 * The signature screen, and the one the product spec treats as the primary
 * playback surface. Its backdrop is derived from the artwork's own dominant
 * colour, falling back to `#191414` when the cover is unreadable — the
 * extraction is in lib/artwork-colour.ts and always resolves, so a blocked
 * image cannot break the view.
 *
 * Accessibility decisions:
 *  - `role="dialog"` with `aria-modal`, because it takes over the viewport and
 *    the content behind it is no longer reachable.
 *  - Focus moves in on open and returns to the trigger on close.
 *  - Escape closes, as does the chevron.
 *  - Reduced motion is honoured for the backdrop fade.
 */
export function NowPlayingView({ onClose }: { onClose: () => void }) {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const queue = usePlayer((s) => s.queue);

  const isLiked = useLibrary((s) => (track ? s.isLiked(trackKey(track)) : false));
  const toggleLike = useLibrary((s) => s.toggleLike);
  const toast = useUi((s) => s.toast);
  const openMenu = useTrackMenu();

  /*
    Colours are cached by URL and read during render, rather than held in one
    slot set from an effect. Three reasons: it avoids a cascading render, it
    keeps the previous track's colour from flashing while the new one decodes,
    and re-opening the view for a track already seen is instant.
  */
  const [colours, setColours] = useState<Record<string, ArtworkColour>>({});
  const [compact, setCompact] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);


  const cover = track?.cover ?? "";
  const colour: ArtworkColour = cover
    ? (colours[cover] ?? { hex: ARTWORK_FALLBACK_BG, fellBack: true })
    : { hex: ARTWORK_FALLBACK_BG, fellBack: true };

  useEffect(() => {
    if (!cover || colours[cover]) return;
    let live = true;
    void extractArtworkColour(cover).then((next) => {
      if (!live) return;
      setColours((prev) => (prev[cover] ? prev : { ...prev, [cover]: next }));
    });
    return () => {
      live = false;
    };
  }, [cover, colours]);

  // Move focus in, and hand it back to whatever was focused before.
  useEffect(() => {
    returnFocus.current = document.activeElement;
    const node = panelRef.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus], button");
    first?.focus();

    return () => {
      if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
    };
  }, []);

  // Escape closes; Tab is trapped so focus cannot leave a modal surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;

      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!track) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${track.title} by ${track.artist}`}
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        // The extracted colour sits behind a dark wash so white text keeps a
        // usable contrast ratio whatever the cover looks like.
        background: `linear-gradient(180deg, ${colour.hex} 0%, ${ARTWORK_FALLBACK_BG} 62%)`,
        transition: "background 600ms ease",
      }}
    >
      {/* Screen-reader announcement when a track ends and the next starts. */}
      <p aria-live="polite" className="sr-only">
        {track.title} by {track.artist}
      </p>

      <header className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          data-autofocus
          onClick={onClose}
          aria-label="Close full screen player"
          className="rounded-full p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          <ChevronDown size={24} />
        </button>
        <div className="min-w-0 flex-1 px-2 text-center">
          <p className="truncate text-[11px] uppercase tracking-wider text-white/70">
            Playing from {queue.length ? "your queue" : "muscify"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCompact((c) => !c)}
          aria-label={compact ? "Expand artwork" : "Shrink artwork"}
          className="rounded-full p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          {compact ? <Maximize2 size={20} /> : <Minimize2 size={20} />}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 pb-4">
        <div
          className={`shrink-0 transition-all duration-500 ${
            compact ? "w-40 sm:w-52" : "w-[min(78vw,420px)]"
          }`}
        >
          <div
            className="aspect-square w-full overflow-hidden rounded-lg shadow-2xl"
            style={{ background: artFallback(track) }}
          >
            {track.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={track.cover}
                alt={`Album artwork for ${track.title}`}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
        </div>

        <div className="w-full max-w-[520px]">
          <div className="mb-1 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {/* Track title carries the explicit marker in its accessible name,
                  matching what the spec describes and what Spotify does. */}
              <h1 className="truncate text-2xl font-bold text-white">
                {track.title}
                {track.explicit ? <span className="sr-only"> Explicit</span> : null}
              </h1>
              {track.album ? (
                <p className="truncate text-sm text-white/60">{track.album}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                toggleLike(track);
                toast(isLiked ? "Removed from Liked Songs" : "Added to Liked Songs", "success");
              }}
              aria-label={isLiked ? `Remove ${track.title} from Liked Songs` : `Save ${track.title} to Liked Songs`}
              aria-pressed={isLiked}
              className="shrink-0 rounded-full p-2 transition hover:bg-white/10"
            >
              <Heart
                size={26}
                className={isLiked ? "fill-spotify text-spotify" : "text-white/80"}
              />
            </button>
            <button
              type="button"
              onClick={(e) => openMenu(e, track)}
              aria-label={`More options for ${track.title}`}
              className="shrink-0 rounded-full p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <MoreHorizontal size={22} />
            </button>
          </div>

          <div className="mt-4 [&_*]:!text-white/85">
            <ProgressBar />
          </div>

          {/*
            PlaybackControls already carries shuffle, transport and repeat, so
            they are reused rather than rebuilt — two sets of the same control
            would be a keyboard trap and a duplicate-name screen-reader mess.
          */}
          <div className="mt-4 flex justify-center">
            <PlaybackControls />
          </div>

          {colour.fellBack ? (
            <p className="mt-4 text-center text-xs text-white/50">
              {track.cover
                ? "Could not read the cover, so this is the default backdrop."
                : "This track has no artwork."}
            </p>
          ) : null}

          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => useUi.getState().setQueueOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-white/25 px-4 py-1.5 text-xs text-white/80 transition hover:border-white/50 hover:text-white"
            >
              <ListMusic size={14} />
              Queue ({queue.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}