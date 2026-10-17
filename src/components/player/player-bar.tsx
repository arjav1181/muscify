"use client";

import { useEffect, useRef } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Heart, ListMusic, ListPlus, Maximize2, Mic2, MoreHorizontal, Radio as RadioIcon } from "lucide-react";
import { artFallback } from "@/lib/art";
import { trackKey, type Track } from "@/lib/types";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";
import { useTrackMenu } from "@/components/track-menu";
import { PlaybackControls } from "./playback-controls";
import { ProgressBar } from "./progress-bar";
import { QueuePanel } from "./queue-panel";
import { NowPlayingView } from "./now-playing-view";
import { VolumeControl } from "./volume-control";
import { SleepTimerMenu } from "./sleep-timer-menu";

function externalUrl(track: Track): string | null {
  if (track.source === "youtube") {
    return track.list
      ? `https://www.youtube.com/playlist?list=${track.list}`
      : `https://www.youtube.com/watch?v=${track.id}`;
  }
  if (track.source === "deezer") return `https://www.deezer.com/track/${track.id}`;
  if (track.source === "soundcloud") return track.url ?? null;
  return null;
}

export function PlayerBar() {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const queue = usePlayer((s) => s.queue);
  const needsGesture = usePlayer((s) => s.needsGesture);
  const ducked = usePlayer((s) => s.ducked);
  const error = usePlayer((s) => s.error);
  const setError = usePlayer((s) => s.setError);
  const unavailable = usePlayer((s) => s.unavailable);
  const setUnavailable = usePlayer((s) => s.setUnavailable);
  const takeYoutubeFallback = usePlayer((s) => s.takeYoutubeFallback);
  const router = useRouter();
  const queueOpen = useUi((s) => s.queueOpen);
  const setQueueOpen = useUi((s) => s.setQueueOpen);

  const nowPlayingOpen = useUi((s) => s.nowPlayingOpen);

  const setNowPlayingOpen = useUi((s) => s.setNowPlayingOpen);
  const lyricsOpen = useUi((s) => s.lyricsOpen);
  const setLyricsOpen = useUi((s) => s.setLyricsOpen);
  const openContextMenu = useUi((s) => s.openContextMenu);

  const barRef = useRef<HTMLElement>(null);
  const trackMenu = useTrackMenu();

  const liked = useLibrary((s) => (track ? s.liked.some((l) => l.key === trackKey(track)) : false));
  const toggleLike = useLibrary((s) => s.toggleLike);
  const lyricsEnabled = useLibrary((s) => s.settings.lyricsEnabled);

  const duck = usePlayer((s) => s.duck);

  useEffect(() => {
    if (!queueOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setQueueOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQueueOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [queueOpen, setQueueOpen]);

  if (!track) {
    return (
      <footer className="grid h-[90px] shrink-0 grid-cols-1 items-center border-t border-line bg-base px-4 text-sm text-dim">
        <p className="text-center">
          Pick something to play — search, browse the charts, or tune in to the radio.
        </p>
      </footer>
    );
  }

  const href = externalUrl(track);

  return (
    /*
      `complementary` rather than `contentinfo`: a contentinfo landmark is for
      site-level metadata (copyright, legal links), not a persistent control
      surface. This is the player bar, and naming it explicitly is the pattern
      captured from Spotify's own accessibility tree in docs/ux-grounding.md.
    */
    <aside
      ref={barRef}
      className="relative shrink-0 border-t border-line bg-base"
      aria-label="Now playing bar"
    >
      {/* Deezer's widget has no seek API, so show an indeterminate state
          rather than a progress bar that would lie. */}
      {track.source === "deezer" ? (
        <div className="absolute inset-x-0 -top-px h-[3px] overflow-hidden bg-highlight">
          <div className="h-full w-1/3 animate-pulse bg-spotify/60" />
        </div>
      ) : null}

      {unavailable ? (
        <div className="flex flex-wrap items-center justify-center gap-2 border-b border-line bg-highlight px-4 py-1.5 text-xs text-sub">
          <AlertTriangle size={13} className="shrink-0 text-amber-400" />
          <span className="truncate">{unavailable.message}</span>
          <button
            type="button"
            onClick={() => {
              // The catalog only holds Deezer ids; the search route is where a
              // Deezer title becomes a playable YouTube video.
              const query = takeYoutubeFallback();
              if (query) router.push(`/search?q=${encodeURIComponent(query)}&tab=videos`);
            }}
            className="shrink-0 rounded-full bg-spotify px-3 py-1 font-semibold text-black transition hover:bg-spotify-dark"
          >
            Search YouTube instead
          </button>
          <button
            type="button"
            onClick={() => setUnavailable(null)}
            aria-label="Dismiss"
            className="shrink-0 rounded px-1 text-dim hover:text-on"
          >
            ✕
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center justify-center gap-2 border-b border-line bg-spotify/10 px-4 py-1.5 text-xs text-spotify">
          <AlertTriangle size={13} className="shrink-0" />
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="ml-1 shrink-0 rounded px-1 text-on/70 hover:text-on"
          >
            ✕
          </button>
        </div>
      ) : null}

      <div className="grid h-[90px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
        {/* Now playing */}
        <div
          className="flex min-w-0 items-center gap-3"
          onContextMenu={(e) => trackMenu(e, track)}
        >
          <div
            className="relative h-14 w-14 shrink-0 overflow-hidden rounded"
            style={{ background: artFallback(track) }}
          >
            {track.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={track.cover}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <RadioIcon size={20} className="text-muted" />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-on" title={track.title}>
              {track.title}
            </p>
            <p className="truncate text-xs text-sub" title={track.artist}>
              {track.artist || "—"}
            </p>
          </div>

          <div className="hidden shrink-0 items-center gap-1 xl:flex">
            <button
              type="button"
              onClick={() => toggleLike(track)}
              aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
              aria-pressed={liked}
              className={`rounded-full p-2 transition hover:bg-highlight ${
                liked ? "text-spotify" : "text-sub hover:text-on"
              }`}
            >
              <Heart size={16} fill={liked ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              onClick={() => duck(3000)}
              aria-label="Duck volume for 3 seconds"
              title="Duck (used when something else talks)"
              className={`rounded-full p-2 transition hover:bg-highlight ${
                ducked ? "text-spotify" : "text-sub hover:text-on"
              }`}
            >
              <Mic2 size={16} />
            </button>
            <SleepTimerMenu />
            <button
              type="button"
              onClick={(e) =>
                openContextMenu(e.clientX, e.clientY, [
                  { label: "Add to queue", run: () => usePlayer.getState().enqueue([track]) },
                  {
                    label: "Play next",
                    run: () => usePlayer.getState().enqueueNext([track]),
                  },
                  {
                    label: liked ? "Remove from Liked Songs" : "Add to Liked Songs",
                    run: () => toggleLike(track),
                  },
                  ...(href
                    ? [
                        {
                          label: "Open on source",
                          run: () => window.open(href, "_blank", "noreferrer"),
                        },
                      ]
                    : []),
                ])
              }
              aria-label="More actions"
              className="rounded-full p-2 text-sub transition hover:bg-highlight hover:text-on"
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>

        {/* Transport */}
        <div className="hidden min-w-0 flex-col items-center gap-1 md:flex">
          <PlaybackControls />
          <ProgressBar />
        </div>

        {/* Volume + queue */}
        <div className="hidden items-center justify-end gap-2 md:flex">
          <VolumeControl />
          <button
            type="button"
            onClick={() => setLyricsOpen(!lyricsOpen)}
            aria-label="Lyrics"
            aria-pressed={lyricsOpen}
            title="Lyrics (L)"
            className={`rounded-full p-2 transition hover:bg-highlight ${
              lyricsOpen ? "text-spotify" : "text-sub hover:text-on"
            } ${lyricsEnabled ? "" : "opacity-40"}`}
          >
            <span className="text-xs font-bold">LYR</span>
          </button>
          <button
            type="button"
            onClick={() => setNowPlayingOpen(true)}
            aria-label="Show Now Playing view"
            title="Show Now Playing view"
            className="rounded-full p-2 text-sub transition hover:bg-highlight hover:text-on"
          >
            <Maximize2 size={17} />
          </button>
          <button
            type="button"
            onClick={() => useUi.getState().openModal({ kind: "equalizer" })}
            aria-label="Open equalizer"
            title="Equalizer"
            className="rounded-full p-2 text-sub transition hover:bg-highlight hover:text-on"
          >
            <SlidersHorizontal size={17} />
          </button>
          <button
            type="button"
            onClick={() => setQueueOpen(!queueOpen)}
            aria-label="Queue"
            aria-expanded={queueOpen}
            title={`Queue (${queue.length})`}
            className={`rounded-full p-2 transition hover:bg-highlight ${
              queueOpen ? "text-spotify" : "text-sub hover:text-on"
            }`}
          >
            <ListMusic size={18} />
          </button>
        </div>
      </div>

      {/* Compact transport for narrow viewports. */}
      <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-2 md:hidden">
        <PlaybackControls compact />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setNowPlayingOpen(true)}
            aria-label="Show Now Playing view"
            title="Show Now Playing view"
            className="rounded-full p-2 text-sub transition hover:text-on"
          >
            <Maximize2 size={18} />
          </button>
          <button
            type="button"
            onClick={() => setQueueOpen(!queueOpen)}
            aria-label="Queue"
            className="rounded-full p-2 text-sub"
          >
            <ListPlus size={18} />
          </button>
        </div>
      </div>
      {nowPlayingOpen && track ? (
        <NowPlayingView onClose={() => setNowPlayingOpen(false)} />
      ) : null}

      {queueOpen ? (
        <div className="absolute right-2 bottom-full z-40 mb-2 max-h-[60vh] w-[min(380px,calc(100vw-16px))] overflow-hidden">
          <QueuePanel inline />
        </div>
      ) : null}

      {/* Autoplay was blocked by the browser policy. */}
      {needsGesture ? (
        <button
          type="button"
          onClick={() => usePlayer.getState().toggle()}
          className="absolute inset-0 z-50 flex items-center justify-center gap-3 bg-black/85 backdrop-blur-sm"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-spotify text-black">
            <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <span className="text-sm font-semibold tracking-wide text-on">
            Tap to start playback
          </span>
        </button>
      ) : null}
    </aside>
  );
}