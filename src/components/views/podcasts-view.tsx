"use client";

import { useState } from "react";
import { Mic2, Play, Search } from "lucide-react";
import { TrackRow } from "@/components/track-row";
import { EmptyState } from "@/components/views/library-view";
import { useDebounced } from "@/hooks/use-debounced";
import { useResource } from "@/hooks/use-resource";
import { usePlayer } from "@/store/player-store";
import type { Show } from "@/lib/sources/podcast-shows";
import type { Track } from "@/lib/types";

/**
 * Podcasts, sourced from YouTube.
 *
 * The shape is chosen to match what the source can honestly support. There is
 * no show entity in the YouTube API, so a "show" is the channel that published
 * the matching episodes, and grouping is done server-side. That is why this page
 * leads with a search rather than a curated shelf: a hand-picked list would be
 * a list of channel ids someone chose once, with no way to tell whether they
 * still publish.
 *
 * Episodes are `Track`s, so they go through the ordinary queue and the ordinary
 * YouTube engine — including its constraints, which are the same ones songs
 * have: a third-party embed with no pause API and no volume control.
 */

/** Curated starting points. Each is a query, not a hard-coded channel id. */
const SEEDS: { label: string; query: string; emoji: string }[] = [
  { label: "True crime", query: "true crime podcast episode", emoji: "🔍" },
  { label: "Tech", query: "technology podcast", emoji: "🛰️" },
  { label: "Comedy", query: "comedy podcast interview", emoji: "🎙️" },
  { label: "News daily", query: "daily news podcast", emoji: "📰" },
  { label: "Sport", query: "sports podcast", emoji: "⚽" },
  { label: "Hindi", query: "hindi podcast", emoji: "🎧" },
  { label: "Business", query: "business entrepreneurship podcast", emoji: "💼" },
  { label: "History", query: "history podcast", emoji: "📜" },
];

interface State {
  episodes: Track[];
  shows: Show[];
  /** A soft message from the API — "nothing matched", not a failure. */
  note: string | null;
}

const EMPTY: State = { episodes: [], shows: [], note: null };

export function PodcastsView() {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 400);
  const q = debounced.trim();
  const playTracks = usePlayer((s) => s.playTracks);

  /*
    useResource rather than a hand-rolled effect, for two reasons that both bit
    this page's first draft. It stores the response against the key it was
    requested for, so a superseded reply can never overwrite a newer one —
    typing "tech pod" fires four queries in a second and the last must win. And
    it never sets state synchronously inside the effect, which is what the
    react-hooks lint rule is there to prevent: a synchronous setState in an
    effect re-renders every consumer of this view before anything has changed.
  */
  const found = useResource(
    q ? `pod:${q}` : null,
    async (signal) => {
      const res = await fetch(
        `/api/podcasts?action=search&q=${encodeURIComponent(q)}&limit=40`,
        { signal },
      );
      const json = (await res.json()) as {
        ok: boolean;
        episodes?: Track[];
        shows?: Show[];
        errors?: string[];
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.errors?.[0] ?? "Podcasts are unavailable right now.");
      }
      return {
        episodes: json.episodes ?? [],
        shows: json.shows ?? [],
        note: json.errors?.[0] ?? null,
      };
    },
  );

  const data = found.data ?? EMPTY;
  const loading = found.loading;
  const error = found.error ?? data.note ?? null;

  const episodes = data.episodes;

  return (
    <div className="animate-fade-up pt-6">
      <h1 className="text-title font-bold tracking-tight text-on">Podcasts</h1>
      <p className="mt-1 mb-5 text-sm text-sub">
        Search podcasts and their episodes, wherever they publish on YouTube.
      </p>

      <div className="relative mb-6 flex max-w-xl items-center">
        <Search size={16} className="pointer-events-none absolute left-4 text-dim" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shows and episodes — try “true crime” or “joe rogan”"
          aria-label="Search podcasts"
          className="w-full rounded-full border border-line-strong bg-elevated py-2.5 pr-4 pl-11
            text-sm text-on placeholder:text-dim focus:border-white/40 focus:outline-none"
        />
      </div>

      {!q ? (
        <section>
          <h2 className="mb-3 text-lg font-bold text-on">Browse by topic</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {SEEDS.map((seed) => (
              <button
                key={seed.label}
                type="button"
                onClick={() => setQuery(seed.query)}
                className="group flex items-center gap-3 rounded-card bg-surface p-3 text-left
                  transition-colors hover:bg-highlight focus-visible:outline-2
                  focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <span
                  aria-hidden
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-elevated text-xl"
                >
                  {seed.emoji}
                </span>
                <span className="truncate text-sm font-semibold text-on">{seed.label}</span>
              </button>
            ))}
          </div>

          <p className="mt-8 max-w-2xl text-xs leading-relaxed text-muted">
            These come from YouTube, which is not a podcast catalogue. A show is the channel that
            published the matching episodes, so podcasts published only on their own site will not
            appear here. Playback uses the same YouTube embed as music, which means no pause
            control and no volume slider while an episode is playing.
          </p>
        </section>
      ) : (
        <>
          {loading && !episodes.length ? <LoadingRows /> : null}

          {error && !episodes.length ? (
            <p className="rounded border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              {error}
            </p>
          ) : null}

          {data.shows.length ? (
            <section className="mb-9">
              <h2 className="mb-3 text-lg font-bold text-on">
                Shows
                <span className="ml-2 text-sm font-normal text-muted">
                  {data.shows.length} publishing what matched
                </span>
              </h2>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {data.shows.map((show) => (
                  <ShowTile key={show.id} show={show} onPick={() => setQuery(show.name)} />
                ))}
              </div>
            </section>
          ) : null}

          {episodes.length ? (
            <section>
              <h2 className="mb-3 text-lg font-bold text-on">
                Episodes
                <span className="ml-2 text-sm font-normal text-muted">newest first</span>
              </h2>
              <div className="flex flex-col">
                {episodes.map((ep, i) => (
                  <TrackRow
                    key={`${ep.source}:${ep.id}`}
                    track={ep}
                    index={i}
                    onPlay={() => playTracks(episodes, i)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {!loading && q && !episodes.length && !error ? (
            <EmptyState
              icon={Mic2}
              headingLevel={2}
              title={`Nothing on YouTube matched “${q}”`}
              body="Podcasts are searched on YouTube rather than from a podcast directory, so this will only find shows that publish there."
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function ShowTile({ show, onPick }: { show: Show; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="group w-44 shrink-0 rounded-card bg-surface p-3 text-left transition-colors
        hover:bg-highlight focus-visible:outline-2 focus-visible:outline-offset-2
        focus-visible:outline-white"
    >
      <div className="relative mb-3 aspect-square overflow-hidden rounded bg-elevated">
        <span className="absolute inset-0 flex items-center justify-center text-dim">
          <Mic2 size={28} aria-hidden />
        </span>
        {show.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={show.image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              // YouTube hands back thumbnail URLs that 404 for some uploads, and
              // the 404 image is a grey rectangle. Hiding it exposes the Mic2
              // fallback underneath rather than showing that placeholder.
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-dim">
            <Mic2 size={28} aria-hidden />
          </span>
        )}
        <span
          className="absolute right-2 bottom-2 flex h-9 w-9 translate-y-1 items-center justify-center
            rounded-full bg-spotify text-black opacity-0 shadow-lg transition
            group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0
            group-focus-visible:opacity-100"
        >
          <Play size={15} fill="currentColor" className="translate-x-px" aria-hidden />
        </span>
      </div>
      <p className="truncate text-sm font-semibold text-on" title={show.name}>
        {show.name}
      </p>
      <p className="mt-1 line-clamp-2 text-xs text-muted" title={show.latest}>
        {show.latest ?? `${show.episodeCount} matching episodes`}
      </p>
    </button>
  );
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-card p-2">
          <div className="h-11 w-11 shrink-0 animate-pulse rounded bg-elevated" />
          <div className="flex-1">
            <div className="mb-2 h-3 w-2/3 animate-pulse rounded bg-elevated" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-elevated" />
          </div>
        </div>
      ))}
    </div>
  );
}