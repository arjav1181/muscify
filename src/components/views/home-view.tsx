"use client";

import { useSyncExternalStore } from "react";
import { Play } from "lucide-react";
import { useBrowse } from "@/hooks/use-music";
import { usePlayer } from "@/store/player-store";
import { Shelf } from "@/components/shelf";
import { TrackCard } from "@/components/track-card";

/**
 * Curated shelves, as on the Spotify home feed.
 *
 * Each rail is a single batched search rather than a bespoke API call, which
 * keeps the page to one request per shelf and means a failing rail degrades
 * to an empty section instead of an error.
 */
const SHELVES: { title: string; query: string; subtitle: string }[] = [
  { title: "Made for you", query: "hits 2026 mix", subtitle: "Fresh picks" },
  { title: "Chill & focus", query: "lofi hip hop beats", subtitle: "Steady tempo, no surprises" },
  { title: "Workout", query: "workout motivation hits", subtitle: "High energy" },
  { title: "Late night", query: "late night r&b vibes", subtitle: "Low lights" },
  { title: "Feel good", query: "feel good pop hits", subtitle: "Upbeat" },
  { title: "90s throwbacks", query: "90s hits", subtitle: "Nostalgia" },
  { title: "Hindi top 40", query: "hindi top 40 songs", subtitle: "Bollywood and more" },
  { title: "Punjabi", query: "punjabi songs", subtitle: "Punjabi hits" },
];

const SUBSCRIBE = () => () => {};

function useHydrated() {
  return useSyncExternalStore(SUBSCRIBE, () => true, () => false);
}

function greetingFor(hour: number): string {
  if (hour < 5) return "Late night listening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeView() {
  const trending = useBrowse("trending");
  const charts = useBrowse("charts");
  const playTracks = usePlayer((s) => s.playTracks);
  const hydrated = useHydrated();

  const greeting = hydrated ? greetingFor(new Date().getHours()) : "Welcome back";
  const featured = trending.results.slice(0, 6);

  return (
    <div className="animate-fade-up pt-6">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-on">{greeting}</h1>

      {featured.length ? (
        /*
         * Square tiles with the title over the artwork and a play button that
         * appears on hover.
         *
         * These were wide 80px-high rows in a three-column grid, which is a
         * different shape to every other surface in the app and made the top of
         * the home page read as a list of search results rather than as
         * something you browse. The artwork carries the tile, so it needs a
         * scrim behind the label — a white title over a bright album cover is
         * otherwise unreadable and the contrast is whatever the cover happened
         * to be.
         */
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7">
          {featured.map((track) => (
            <button
              key={`${track.source}:${track.id}`}
              type="button"
              onClick={() => playTracks([track], 0, { kind: "single", id: track.id })}
              className="group relative block aspect-square w-full overflow-hidden rounded-card
                bg-elevated text-left shadow-[0_4px_12px_rgba(0,0,0,0.3)] transition
                hover:bg-highlight focus-visible:outline-2 focus-visible:outline-offset-2
                focus-visible:outline-white"
            >
              {track.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={track.cover}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform
                    duration-300 group-hover:scale-[1.04]"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : null}

              {/* Scrim, heavier at the bottom where the title sits. */}
              <span
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
              />

              <span className="absolute right-2 bottom-2 flex h-10 w-10 items-center justify-center
                rounded-full bg-spotify text-black opacity-0 shadow-lg transition
                group-hover:opacity-100 group-focus-visible:opacity-100">
                <Play size={18} fill="currentColor" className="translate-x-px" aria-hidden />
              </span>

              <span className="absolute right-0 bottom-0 left-0 line-clamp-2 p-3 text-sm font-bold text-white">
                {track.title}
              </span>
              {/* The play button is decorative — the tile itself is the control
                  and its accessible name is the track title. */}
              <span className="sr-only">Play {track.title}</span>
            </button>
          ))}
        </div>
      ) : null}

      <Shelf
        title="Trending now"
        subtitle="YouTube's current music chart"
        tracks={trending.results.slice(6)}
        loading={trending.loading}
        errors={trending.errors}
        emptyLabel="The chart is unavailable right now."
      />

      <Shelf
        title="Top charts"
        subtitle="Deezer's global chart"
        tracks={charts.results}
        loading={charts.loading}
        errors={charts.errors}
        emptyLabel="Charts are unavailable right now."
      />

      {/* Batched shelves: one request each, each independent. */}
      <CuratedShelves />
    </div>
  );
}

function CuratedShelves() {
  return (
    <>
      {SHELVES.slice(0, 4).map((shelf) => (
        <CuratedShelf key={shelf.title} {...shelf} />
      ))}
    </>
  );
}

function CuratedShelf({ title, query, subtitle }: { title: string; query: string; subtitle: string }) {
  const { results, errors, loading } = useBrowse(`curated:${query}`);
  const playTracks = usePlayer((s) => s.playTracks);

  return (
    <Shelf
      title={title}
      subtitle={subtitle}
      tracks={results}
      loading={loading}
      errors={errors}
      emptyLabel="Nothing here right now."
      onPlayAll={
        results.length ? () => playTracks(results, 0, { kind: "shelf", id: query }) : undefined
      }
      renderCard={(track, i) => (
        <TrackCard track={track} index={i} tracks={results} />
      )}
    />
  );
}