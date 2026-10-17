"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Disc3, Mic2, Sparkles } from "lucide-react";
import type { Track } from "@/lib/types";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useResource } from "@/hooks/use-resource";
import { MOODS } from "@/lib/sources/recommend";
import {
  DaylistShelf,
  PromptPlaylist,
  TasteProfilePanel,
  WeeklyShelf,
} from "@/components/views/discovery-panels";
import { Shelf } from "@/components/shelf";
import { TrackCard } from "@/components/track-card";

function useMoodTracks(query: string) {
  return useResource(query ? `mood:${query}` : null, async (signal) => {
    const res = await fetch(
      `/api/music/search?${new URLSearchParams({ q: query, tab: "songs" })}`,
      { signal },
    );
    const json = (await res.json()) as { results?: Track[] };
    return (json.results ?? []).slice(0, 10);
  });
}

function MoodShelf({ title, subtitle, query }: { title: string; subtitle: string; query: string }) {
  const { data, loading } = useMoodTracks(query);
  const playTracks = usePlayer((s) => s.playTracks);
  const tracks = data ?? [];

  return (
    <Shelf
      title={title}
      subtitle={subtitle}
      tracks={tracks}
      loading={loading}
      onPlayAll={tracks.length ? () => playTracks(tracks, 0, { kind: "mood", id: query }) : undefined}
      renderCard={(track, i) => <TrackCard track={track} index={i} tracks={tracks} />}
    />
  );
}

/**
 * "Because you played…" rows.
 *
 * Built from the listening history: the most-played Deezer artists are fed to
 * that artist's curated radio, which is the strongest recommendation source
 * available without an API key. YouTube tracks carry no Deezer artist id, so
 * they fall back to a text-seeded search.
 */
function BecauseYouPlayed() {
  const catalog = useLibrary((s) => s.catalog);
  const recentlyPlayed = useLibrary((s) => s.recentlyPlayed);

  const seeds = useMemo(() => {
    const seen = new Set<string>();
    const out: { artistId: string; name: string }[] = [];
    for (const entry of recentlyPlayed) {
      const track = catalog[entry.key]?.track;
      if (!track?.artistId || seen.has(track.artistId)) continue;
      seen.add(track.artistId);
      out.push({ artistId: track.artistId, name: track.artist });
      if (out.length >= 3) break;
    }
    return out;
  }, [catalog, recentlyPlayed]);

  if (!seeds.length) return null;

  return (
    <>
      {seeds.map((seed) => (
        <ArtistRadioShelf key={seed.artistId} artistId={seed.artistId} name={seed.name} />
      ))}
    </>
  );
}

function ArtistRadioShelf({ artistId, name }: { artistId: string; name: string }) {
  const { data, loading, error } = useResource(
    `radio:${artistId}`,
    async (signal) => {
      const res = await fetch(
        `/api/music/recommend?${new URLSearchParams({
          mode: "seeded",
          source: "deezer",
          artistId,
          artist: name,
        })}`,
        { signal },
      );
      const json = (await res.json()) as { results?: Track[] };
      return json.results ?? [];
    },
  );
  const playTracks = usePlayer((s) => s.playTracks);
  const tracks = data ?? [];

  return (
    <Shelf
      title={`${name} radio`}
      subtitle="From your listening"
      tracks={tracks}
      loading={loading}
      errors={error ? [error] : []}
      onPlayAll={tracks.length ? () => playTracks(tracks, 0, { kind: "artist-radio", id: artistId }) : undefined}
      renderCard={(track, i) => <TrackCard track={track} index={i} tracks={tracks} />}
    />
  );
}

/** Similar artists, from Deezer's similarity graph. */
function RelatedArtistsRail() {
  const catalog = useLibrary((s) => s.catalog);
  const recentlyPlayed = useLibrary((s) => s.recentlyPlayed);

  // Memos return primitives so downstream effects depend on a string, not a
  // freshly-shaped object.
  const seedId = useMemo(() => {
    for (const entry of recentlyPlayed) {
      const track = catalog[entry.key]?.track;
      if (track?.artistId) return track.artistId;
    }
    return null;
  }, [catalog, recentlyPlayed]);

  const seedName = useMemo(() => {
    if (!seedId) return "";
    for (const entry of recentlyPlayed) {
      const track = catalog[entry.key]?.track;
      if (track?.artistId === seedId) return track.artist;
    }
    return "";
  }, [catalog, recentlyPlayed, seedId]);
  const { data, loading } = useResource(
    seedId ? `related:${seedId}` : null,
    async (signal) => {
      const res = await fetch(
        `/api/music/recommend?${new URLSearchParams({ mode: "related", artistId: seedId! })}`,
        { signal },
      );
      const json = (await res.json()) as {
        artists?: { id: string; name: string; image?: string }[];
      };
      return json.artists ?? [];
    },
  );

  const artists = data ?? [];
  if (!seedId || (!loading && !artists.length)) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-2xl font-bold tracking-tight text-on">Fans also like</h2>
      <p className="mb-4 text-sm text-sub">Artists similar to {seedName}</p>
      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded bg-highlight" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {artists.map((a) => (
            <Link
              key={a.id}
              href={`/artist/${a.id}?source=deezer`}
              className="flex flex-col items-center rounded-card bg-surface p-3 text-center transition-colors hover:bg-highlight"
            >
              <div className="mb-3 h-20 w-20 overflow-hidden rounded-full bg-highlight">
                {a.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <Mic2 size={22} className="mx-auto mt-7 text-white/30" />
                )}
              </div>
              <h3 className="w-full truncate text-sm font-semibold text-on">{a.name}</h3>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Discover.
 *
 * Honest about what it is: mood shelves and artist radio seeded from your own
 * listening, not a collaborative-filtering engine. Each row names the real
 * source behind it rather than implying Spotify-grade personalisation.
 */
export function DiscoverView() {
  // Gated on the same record the discovery panels read. This used to test
  // `recentlyPlayed`, which is a different log — a listener whose history came
  // from the v1 migration, or whose play events were pruned, would see the
  // cold-start copy while their stats page had plenty to show.
  const hasHistory = useLibrary(
    (s) => s.taste.plays.some((play) => !play.private && play.ms >= 30_000),
  );

  return (
    <div className="animate-fade-up pt-6">
      <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-on">
        <Sparkles size={20} className="text-spotify" /> Made for you
      </h2>
      <p className="mt-1 mb-8 max-w-2xl text-sm text-sub">
        Mood shelves and artist radio, seeded from what you&apos;ve played. These come from
        Deezer&apos;s curated artist radio and similarity graph — not a
        collaborative-filtering engine like Spotify&apos;s, which runs on listening data
        that only exists inside Spotify.
      </p>

      <PromptPlaylist />

      {hasHistory ? (
        <>
          <DaylistShelf />
          <WeeklyShelf />
          <TasteProfilePanel />
          <BecauseYouPlayed />
          <RelatedArtistsRail />
        </>
      ) : (
        <div className="mb-10 rounded-lg border border-line bg-surface p-6">
          <div className="flex items-start gap-4">
            <Disc3 size={24} className="mt-0.5 shrink-0 text-spotify" />
            <div>
              <h3 className="text-base font-semibold text-on">
                Personalised rows appear once you play something
              </h3>
              <p className="mt-1 text-sm text-sub">
                Play a few tracks and this page will start building artist radio and
                &ldquo;fans also like&rdquo; shelves from them. Mood shelves below work right
                away.
              </p>
            </div>
          </div>
        </div>
      )}

      <h3 className="mb-4 text-xl font-bold tracking-tight text-on">Browse by mood</h3>
      {MOODS.slice(0, 6).map((mood) => (
        <MoodShelf key={mood.id} title={`${mood.emoji} ${mood.title}`} subtitle={mood.subtitle} query={mood.query} />
      ))}
    </div>
  );
}

