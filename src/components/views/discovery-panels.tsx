"use client";

import { useMemo, useState } from "react";
import { Compass, Radar, Sparkles, Wand2 } from "lucide-react";
import {
  activeBucket,
  bucketArtists,
  tasteProfile,
  weeklyPicks,
  type Catalogue,
  type TrackMeta,
} from "@/lib/discovery/discovery";
import { describeIntent, intentToQueries, parsePrompt } from "@/lib/discovery/prompt";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";
import { useResource } from "@/hooks/use-resource";
import { Shelf } from "@/components/shelf";
import { TrackCard } from "@/components/track-card";
import type { Track } from "@/lib/types";

/**
 * Discovery surfaces derived from the local play log.
 *
 * All of these are computed on-device from what has actually been played. They
 * cannot know about artists the listener has never touched, and that is a real
 * limitation rather than a bug — each panel says where its data comes from
 * instead of implying a server-side recommender.
 */

/**
 * `Track` carries no tag field — only radio stations do. Radio tracks do carry
 * a language and region, so those stand in as descriptive tags; everything else
 * honestly reports none, and the taste profile says so rather than inventing
 * genres from titles.
 */
function metaOf(track: Track) {
  const tags =
    track.source === "radio"
      ? [track.language, track.region].filter(Boolean) as string[]
      : undefined;
  return {
    artist: track.artist || "Unknown",
    title: track.title,
    album: track.album,
    year: track.year,
    duration: track.duration,
    tags,
  };
}

/** Adapts the store's catalogue to the shape the discovery module expects. */
function useCatalogue(): Catalogue {
  const catalog = useLibrary((s) => s.catalog);
  return useMemo(
    () => ({
      get: (key: string): TrackMeta | undefined => {
        const entry = catalog[key];
        if (!entry) return undefined;
        return { key, ...metaOf(entry.track) };
      },
      all: (): TrackMeta[] =>
        Object.entries(catalog).map(([key, entry]) => ({ key, ...metaOf(entry.track) })),
    }),
    [catalog],
  );
}

// ---------------------------------------------------------------- daylist

export function DaylistShelf() {
  const playTracks = usePlayer((s) => s.playTracks);
  const plays = useLibrary((s) => s.taste.plays);
  const catalogue = useCatalogue();
  const catalog = useLibrary((s) => s.catalog);

  const bucket = useMemo(() => activeBucket(plays), [plays]);
  const artists = useMemo(() => bucketArtists(plays, catalogue, bucket.id, 10), [plays, catalogue, bucket.id]);

  const tracks = useMemo(
    () =>
      artists
        .map((a) => {
          const key = Object.keys(catalog).find(
            (k) => catalog[k].track.artist === a.name,
          );
          return key ? catalog[key].track : null;
        })
        .filter((t): t is Track => t !== null),
    [artists, catalog],
  );

  if (tracks.length === 0) return null;

  return (
    <section className="mb-8">
      <p className="mb-3 flex items-center gap-2 text-xs text-muted">
        <Compass className="h-3.5 w-3.5" aria-hidden />
        Built from what you listen to at this hour — not a server-side editorial list.
      </p>
      <Shelf
        title={bucket.label}
        subtitle={bucket.blurb}
        tracks={tracks.slice(0, 12)}
        onPlayAll={() => playTracks(tracks, 0, { kind: "daylist", id: bucket.id })}
        renderCard={(track, i) => <TrackCard track={track} index={i} tracks={tracks} />}
      />
    </section>
  );
}

// ------------------------------------------------------- discover weekly

export function WeeklyShelf() {
  const playTracks = usePlayer((s) => s.playTracks);
  const plays = useLibrary((s) => s.taste.plays);
  const catalogue = useCatalogue();
  const catalog = useLibrary((s) => s.catalog);

  const picks = useMemo(() => weeklyPicks(catalogue, plays, new Date(), 12), [catalogue, plays]);
  const tracks = useMemo(
    () => picks.map((p) => catalog[p.key]?.track).filter((t): t is Track => Boolean(t)),
    [picks, catalog],
  );

  if (tracks.length < 4) return null;

  return (
    <section className="mb-8">
      <p className="mb-3 flex items-center gap-2 text-xs text-muted">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Weighted toward what you actually play. Same all week, reshuffles Monday — no server
        schedule involved.
      </p>
      <Shelf
        title="Discover Weekly"
        tracks={tracks}
        onPlayAll={() => playTracks(tracks, 0, { kind: "weekly", id: "weekly" })}
        renderCard={(track, i) => <TrackCard track={track} index={i} tracks={tracks} />}
      />
    </section>
  );
}

// --------------------------------------------------------- taste profile

export function TasteProfilePanel() {
  const plays = useLibrary((s) => s.taste.plays);
  const catalogue = useCatalogue();
  const profile = useMemo(() => tasteProfile(plays, catalogue), [plays, catalogue]);

  if (profile.cold) {
    return (
      <section className="mb-8 rounded-lg border border-white/10 bg-white/5 p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Radar className="h-4 w-4 text-dim" aria-hidden />
          Taste profile
        </h2>
        <p className="mt-2 text-sm text-dim">
          Not enough listening history yet — play a dozen tracks and this fills in with your own
          top artists and tags. Nothing is sent anywhere; it is computed from a log kept in this
          browser.
        </p>
      </section>
    );
  }

  const maxArtist = profile.topArtists[0]?.ms ?? 1;

  return (
    <section className="mb-8 rounded-lg border border-white/10 bg-white/5 p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <Radar className="h-4 w-4 text-dim" aria-hidden />
        Taste profile
      </h2>
      <p className="mb-4 text-xs text-muted">
        A description of your listening distribution — not an assessment of you. Hide, snooze and
        private sessions all change what appears here.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Top artists
          </h3>
          <ul className="space-y-1">
            {profile.topArtists.slice(0, 6).map((artist) => (
              <li key={artist.name} className="flex items-center gap-2 text-sm">
                <span className="w-32 shrink-0 truncate text-white/75">{artist.name}</span>
                <span
                  className="h-1.5 rounded-full bg-white/40"
                  style={{ width: `${Math.max(6, (artist.ms / maxArtist) * 100)}%` }}
                />
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
                  {Math.round(artist.share * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Most-listened tags
          </h3>
          {profile.topTags.length === 0 ? (
            <p className="text-sm text-muted">
              No tags recorded — this only fills in for tracks whose source reports them.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {profile.topTags.slice(0, 14).map((tag) => (
                <span
                  key={tag.tag}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-dim"
                >
                  {tag.tag}
                </span>
              ))}
            </div>
          )}
          {profile.coldTags.length > 0 ? (
            <p className="mt-3 text-xs text-muted">
              Rarely heard: {profile.coldTags.slice(0, 6).join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------- prompted playlist

function usePromptTracks(queries: string[]) {
  return useResource(queries.length ? `prompt:${queries.join("|")}` : null, async (signal) => {
    const out: Track[] = [];
    const seen = new Set<string>();
    for (const q of queries) {
      try {
        const res = await fetch(
          `/api/music/search?${new URLSearchParams({ q, tab: "songs" })}`,
          { signal },
        );
        const json = (await res.json()) as { results?: Track[] };
        for (const track of json.results ?? []) {
          const key = `${track.source}:${track.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(track);
        }
      } catch {
        // One failed query should not empty the rest; a partial shelf still beats
        // an error page.
      }
      if (out.length >= 30) break;
    }
    return out;
  });
}

export function PromptPlaylist() {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const toast = useUi((s) => s.toast);

  const intent = useMemo(() => (submitted ? parsePrompt(submitted) : null), [submitted]);
  const queries = useMemo(() => (intent ? intentToQueries(intent) : []), [intent]);
  const { data, loading } = usePromptTracks(queries);
  const playTracks = usePlayer((s) => s.playTracks);
  const createPlaylist = useLibrary((s) => s.createPlaylist);
  const addToPlaylist = useLibrary((s) => s.addToPlaylist);

  // Subscribing to `taste` is what makes this re-filter when a hide or snooze
  // changes. Not memoised: the list is at most ~30 items, so recomputing per
  // render is cheaper than tracking which slice of the store it depends on.
  const taste = useLibrary((s) => s.taste);
  const excludeExplicit = useLibrary((s) => s.settings.excludeExplicit);
  const filterByTaste = useLibrary((s) => s.filterByTaste);
  void taste;
  void excludeExplicit;

  // Suppression is applied after results arrive: the search sources are remote
  // and cannot know what this listener has hidden.
  const tracks = filterByTaste(data ?? []);

  const submit = (value: string) => {
    const q = value.trim();
    if (!q) return;
    setSubmitted(q);
    setDraft("");
    const parsed = parsePrompt(q);
    if (parsed.coverage < 0.15) {
      toast(describeIntent(parsed), "error");
    }
  };

  const save = () => {
    if (tracks.length === 0) return;
    const label = intent?.moods[0]?.replace("_", " ") ?? "Prompted";
    const created = createPlaylist(label.charAt(0).toUpperCase() + label.slice(1));
    if (!created) return;
    addToPlaylist(created.id, tracks);
    toast(`Saved ${tracks.length} tracks to ${created.name}`, "success");
  };

  return (
    <section className="mb-8 rounded-lg border border-white/10 bg-white/5 p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <Wand2 className="h-4 w-4 text-dim" aria-hidden />
        Describe what you want to hear
      </h2>
      <p className="mb-3 text-xs text-muted">
        Moods, languages, eras and artists all work. Try{" "}
        <em>“90s punjabi bhangra for the gym”</em> or <em>“chill korean like DPR IAN”</em>.
      </p>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. calm instrumental for studying"
          aria-label="Describe the playlist you want"
          className="flex-1 rounded-full border border-line-strong bg-black/30 px-4 py-2 text-sm placeholder:text-muted focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          disabled={!draft.trim()}
        >
          Create
        </button>
      </form>

      {intent ? (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted">{describeIntent(intent)}</p>

          {intent.terms.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {intent.terms.slice(0, 8).map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => submit(term)}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/65 hover:border-white/30 hover:text-white"
                >
                  {term}
                </button>
              ))}
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-muted">Searching…</p>
          ) : tracks.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing matched. Try fewer words, or name an artist or language you know is in the
              sources.
            </p>
          ) : (
            <>
              <ol className="divide-y divide-white/5">
                {tracks.slice(0, 12).map((track, i) => (
                  <li key={track.source + track.id} className="flex items-center gap-3 py-1.5">
                    <span className="w-5 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{track.title}</span>
                      <span className="block truncate text-xs text-muted">{track.artist}</span>
                    </span>
                    {track.duration ? (
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, "0")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => playTracks(tracks, 0)}
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black"
                >
                  Play {tracks.length}
                </button>
                <button
                  type="button"
                  onClick={save}
                  className="rounded-full border border-line-strong px-4 py-1.5 text-xs font-medium text-white/75 hover:text-white"
                >
                  Save as playlist
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}