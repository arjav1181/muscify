import { test } from "node:test";
import assert from "node:assert/strict";

import { groupShows } from "./podcast-shows.ts";
import type { Track } from "../types.ts";

/**
 * Show derivation.
 *
 * YouTube has no show entity, so this grouping is the only thing standing
 * between a list of videos and a podcast page. If it is wrong the page lies
 * about who publishes what, which is worse than showing raw episodes.
 */

const episode = (over: Partial<Track> & { id: string; artistId?: string }): Track => ({
  source: "youtube",
  title: over.artistId ? `Episode of ${over.artistId}` : "Episode",
  artist: "Some Show",
  cover: "",
  ...over,
});

test("episodes from one channel collapse to one show", () => {
  const shows = groupShows([
    episode({ id: "aaaaaaaaaaa", artistId: "UC1", title: "Ep 3", cover: "c3.jpg" }),
    episode({ id: "bbbbbbbbbbb", artistId: "UC1", title: "Ep 2" }),
    episode({ id: "ccccccccccc", artistId: "UC1", title: "Ep 1" }),
  ]);
  assert.equal(shows.length, 1);
  assert.equal(shows[0]!.id, "UC1");
  assert.equal(shows[0]!.episodeCount, 3);
});

test("the first episode seen supplies the subtitle and artwork", () => {
  const shows = groupShows([
    episode({ id: "aaaaaaaaaaa", artistId: "UC1", title: "Newest Episode", cover: "new.jpg" }),
    episode({ id: "bbbbbbbbbbb", artistId: "UC1", title: "Older", cover: "old.jpg" }),
  ]);
  assert.equal(shows[0]!.latest, "Newest Episode");
  assert.equal(shows[0]!.image, "new.jpg");
});

test("different channels become different shows", () => {
  const shows = groupShows([
    episode({ id: "aaaaaaaaaaa", artistId: "UC1" }),
    episode({ id: "bbbbbbbbbbb", artistId: "UC2" }),
  ]);
  assert.equal(shows.length, 2);
  assert.deepEqual(shows.map((s) => s.id).sort(), ["UC1", "UC2"]);
});

test("episodes with no channel cannot form a show and are dropped", () => {
  // search.list always returns channelId, but a defensive drop beats grouping
  // every unattributed video into one nameless show.
  const shows = groupShows([
    episode({ id: "aaaaaaaaaaa" }),
    episode({ id: "bbbbbbbbbbb" }),
  ]);
  assert.deepEqual(shows, []);
});

test("shows are ordered by how many episodes matched", () => {
  const shows = groupShows([
    episode({ id: "aaaaaaaaaaa", artistId: "UC1" }),
    episode({ id: "bbbbbbbbbbb", artistId: "UC2" }),
    episode({ id: "ccccccccccc", artistId: "UC2" }),
  ]);
  assert.equal(shows[0]!.id, "UC2", "two episodes outranks one");
});

test("an empty result is not a crash", () => {
  assert.deepEqual(groupShows([]), []);
});