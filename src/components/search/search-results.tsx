"use client";

import { Loader2, Search as SearchIcon } from "lucide-react";
import type { SearchTab, Track } from "@/lib/types";
import { useSearch } from "@/hooks/use-search";
import { usePlayer } from "@/store/player-store";
import { TrackList } from "@/components/track-row";
import { AlbumCard, ArtistCard, TrackCard } from "@/components/track-card";

const TABS: { id: SearchTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "songs", label: "Songs" },
  { id: "videos", label: "Videos" },
  { id: "artists", label: "Artists" },
  { id: "albums", label: "Albums" },
  { id: "playlists", label: "Playlists" },
  { id: "radio", label: "Radio" },
];

interface TabResponse {
  results?: Track[];
  errors?: string[];
}

/**
 * Results pane.
 *
 * Each tab is fetched independently, so a failing source narrows to an empty
 * section rather than taking the page down — and "All" fans out across the
 * content tabs so one result type can be slow or empty without blocking others.
 */
export function SearchResults({
  query,
  tab,
  onTabChange,
}: {
  query: string;
  tab: SearchTab;
  onTabChange: (tab: SearchTab) => void;
}) {
  const { results, artists, albums, playlists, errors, loading, error } = useSearch(query, tab);
  const playTracks = usePlayer((s) => s.playTracks);

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Search filters">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTabChange(t.id)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-on bg-on text-black"
                : "border-line-strong text-sub hover:border-on hover:text-on"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {errors.length ? (
        <div className="mb-4 space-y-1 rounded-md border border-spotify/30 bg-spotify/10 px-3 py-2 text-xs text-spotify">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      ) : null}

      {loading && !results.length ? (
        <p className="flex items-center gap-2 py-8 text-sm text-sub">
          <Loader2 size={16} className="animate-spin" /> Searching…
        </p>
      ) : results.length || artists.length || albums.length || playlists.length ? (
        <div className="space-y-10">
          {artists.length ? (
            <section>
              <h2 className="mb-3 text-lg font-bold text-on">Artists</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {artists.map((a, i) => (
                  <ArtistCard
                    key={`${a.source}:${a.id}:${i}`}
                    artist={{ id: a.id, name: a.name, image: a.image }}
                    href={`/artist/${encodeURIComponent(a.id)}?source=${a.source}`}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {albums.length ? (
            <section>
              <h2 className="mb-3 text-lg font-bold text-on">Albums</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {albums.map((a, i) => (
                  <AlbumCard key={`${a.id}:${i}`} album={a} href={`/album/${a.id}`} />
                ))}
              </div>
            </section>
          ) : null}

          {playlists.length ? (
            <section>
              <h2 className="mb-3 text-lg font-bold text-on">Playlists</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {playlists.map((p, i) => (
                  <PlaylistResultCard key={`${p.id}:${i}`} playlist={p} />
                ))}
              </div>
            </section>
          ) : null}

          {results.length ? (
            tab === "songs" || tab === "radio" ? (
              <TrackList
                tracks={results}
                onPlayIndex={(i) =>
                  playTracks(results, i, { kind: "search", id: query })
                }
              />
            ) : (
              <section>
                <h2 className="mb-3 text-lg font-bold text-on">
                  {tab === "videos" ? "Videos" : "Tracks"}
                </h2>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {results.map((track, i) => (
                    <TrackCard
                      key={`${track.source}:${track.id}:${i}`}
                      track={track}
                      index={i}
                      tracks={results}
                    />
                  ))}
                </div>
              </section>
            )
          ) : null}
        </div>
      ) : (
        <div className="py-10 text-center text-sm text-dim">
          <SearchIcon size={22} className="mx-auto mb-3 opacity-50" />
          No results for “{query}” in {tab}.
        </div>
      )}
    </div>
  );
}

function PlaylistResultCard({ playlist }: { playlist: Track }) {
  const playTracks = usePlayer((s) => s.playTracks);

  return (
    <a
      href={`/playlist/${playlist.id}`}
      onClick={(e) => {
        // Open the remote playlist directly in-engine rather than navigating,
        // matching how clicking a track plays it.
        e.preventDefault();
        playTracks([playlist], 0, { kind: "playlist", id: playlist.id });
      }}
      className="flex flex-col rounded-card bg-surface p-3 transition-colors hover:bg-highlight"
    >
      <div className="mb-4 aspect-square w-full overflow-hidden rounded bg-highlight">
        {playlist.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={playlist.cover} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : null}
      </div>
      <h3 className="truncate text-sm font-semibold text-on">{playlist.title}</h3>
      <p className="mt-1 truncate text-xs text-sub">{playlist.artist}</p>
      {playlist.itemCount ? (
        <p className="mt-0.5 text-xs text-dim">{playlist.itemCount} tracks</p>
      ) : null}
    </a>
  );
}

export type { TabResponse };