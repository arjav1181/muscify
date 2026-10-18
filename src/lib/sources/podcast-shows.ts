/**
 * Show derivation from episode results.
 *
 * YouTube has no show, season or episode-number entity. A show is the channel
 * that published the episodes, and that relationship has to be inferred.
 *
 * Kept apart from the fetcher on purpose: this is pure logic, and pure logic
 * deserves to be testable without standing up a network client or resolving the
 * bundler's path alias.
 */

import type { Track } from "../types.ts";

/** A show is a channel that published something matching the query. */
export interface Show {
  id: string;
  name: string;
  image: string;
  description: string;
  /** Latest episode title, used as the subtitle under the name. */
  latest?: string;
  /** How many of the returned episodes this channel published. */
  episodeCount: number;
}

/**
 * Groups episodes into shows by publishing channel.
 *
 * Grouping is better than searching channels directly for a podcast query: it
 * means a show is only offered when it actually published something that
 * matched, rather than when its name merely resembles the search. A channel
 * called "The Daily" with nothing to do with podcasts should not appear under
 * a search for "the daily".
 *
 * Episodes without a channel are dropped rather than collected into one
 * nameless show. `search.list` always returns `channelId`, so this is
 * defensive, but a silent wrong answer here would misattribute someone's feed.
 */
export function groupShows(episodes: Track[]): Show[] {
  const byChannel = new Map<string, Show>();

  for (const ep of episodes) {
    const id = ep.artistId;
    if (!id) continue;

    const existing = byChannel.get(id);
    if (existing) {
      existing.episodeCount += 1;
      continue;
    }

    byChannel.set(id, {
      id,
      name: ep.artist,
      // Channel artwork is not in the search response. The newest episode's
      // thumbnail stands in, which is usually what the channel is currently
      // promoting anyway.
      image: ep.cover,
      description: "",
      latest: ep.title,
      episodeCount: 1,
    });
  }

  return [...byChannel.values()].sort(
    (a, b) => b.episodeCount - a.episodeCount || a.name.localeCompare(b.name),
  );
}