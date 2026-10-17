import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeBucket,
  bucketArtists,
  bucketForHour,
  bucketHistogram,
  releaseRadar,
  seededRandom,
  tasteProfile,
  TIME_BUCKETS,
  weeklyPicks,
  weeklySeed,
  type Catalogue,
  type TrackMeta,
} from "./discovery.ts";
import type { PlayEvent } from "@/lib/taste/taste";

function meta(key: string, artist: string, tags?: string[], year?: string): TrackMeta {
  return { key, artist, title: key, tags, year, album: `${artist} album` };
}

/** Catalogue over a fixed list. */
function cat(tracks: TrackMeta[]): Catalogue {
  const byKey = new Map(tracks.map((t) => [t.key, t]));
  return { get: (k) => byKey.get(k), all: () => tracks };
}

function at(hour: number, day = 0) {
  return new Date(2026, 5, 3 + day, hour, 0, 0).getTime();
}

function play(key: string, when: number, ms = 180_000, priv = false): PlayEvent {
  return { key, at: when, ms, private: priv };
}

test("hours map to the expected bucket, including across midnight", () => {
  assert.equal(bucketForHour(7).id, "early");
  assert.equal(bucketForHour(13).id, "daytime");
  assert.equal(bucketForHour(19).id, "evening");
  assert.equal(bucketForHour(23).id, "late");
  // The late bucket wraps past midnight; this is the part that is easy to get wrong.
  assert.equal(bucketForHour(2).id, "late");
  assert.equal(bucketForHour(1).id, "late");
});

test("every hour of the day falls into exactly one bucket", () => {
  const seen = new Map<string, number[]>();
  for (let h = 0; h < 24; h++) {
    const id = bucketForHour(h).id;
    seen.set(id, [...(seen.get(id) ?? []), h]);
  }
  assert.equal(seen.size, TIME_BUCKETS.length, "all four buckets should be reachable");
  const total = [...seen.values()].reduce((n, hours) => n + hours.length, 0);
  assert.equal(total, 24);
});

test("bucket histogram counts only qualifying, non-private plays", () => {
  const plays = [
    play("a", at(8), 180_000),
    play("b", at(8), 180_000),
    play("c", at(8), 5_000), // too short
    play("d", at(8), 180_000, true), // private
    play("e", at(20), 180_000),
  ];
  const histogram = bucketHistogram(plays);
  assert.equal(histogram.get("early"), 2);
  assert.equal(histogram.get("evening"), 1);
});

test("active bucket is the listener's peak, not the clock's", () => {
  // Two morning plays versus one evening play.
  const plays = [play("a", at(8)), play("b", at(9)), play("c", at(20))];
  assert.equal(activeBucket(plays).id, "early");
});

test("active bucket falls back to the clock on a cold start", () => {
  // 13:00 on a fixed date is daytime.
  assert.equal(activeBucket([], new Date(2026, 5, 3, 13)).id, "daytime");
});

test("bucket artists rank by listened time within that window", () => {
  const plays = [
    play("a", at(8), 300_000),
    play("b", at(8), 100_000),
    play("c", at(8), 200_000),
    play("d", at(20), 999_000), // different bucket, must be ignored
  ];
  const c = cat([meta("a", "Alpha"), meta("b", "Beta"), meta("c", "Alpha"), meta("d", "Gamma")]);
  const ranked = bucketArtists(plays, c, "early");
  assert.deepEqual(
    ranked.map((r) => r.name),
    ["Alpha", "Beta"],
  );
  assert.equal(ranked[0].ms, 500_000, "Alpha's two morning plays should add up");
});

test("taste profile is descriptive and reports concentration", () => {
  const plays = [play("a", at(8), 300_000), play("a", at(9), 300_000), play("b", at(10), 100_000)];
  const c = cat([meta("a", "Alpha", ["house", "electronic"]), meta("b", "Beta", ["rock"])]);
  const profile = tasteProfile(plays, c);

  assert.equal(profile.topArtists[0].name, "Alpha");
  assert.ok(Math.abs(profile.concentration - 600_000 / 700_000) < 1e-6);
  assert.equal(profile.topTags[0].tag, "house");
  // Only three qualifying plays, which is below the reporting threshold.
  assert.equal(profile.cold, true, "a thin log should still read as cold");
});

test("a substantial play log is not reported as cold", () => {
  const tracks = Array.from({ length: 14 }, (_, i) => meta(`t${i}`, "Alpha", ["house"]));
  const c = cat(tracks);
  const plays = tracks.map((t, i) => play(t.key, at(8 + (i % 12)), 180_000));
  assert.equal(tasteProfile(plays, c).cold, false);
});

test("taste profile reports cold rather than inventing an answer", () => {
  const c = cat([meta("a", "Alpha")]);
  assert.equal(tasteProfile([play("a", at(8))], c).cold, true, "one play is not a taste profile");
  assert.equal(tasteProfile([], c).cold, true);
});

test("taste profile excludes private plays entirely", () => {
  const plays = [play("a", at(8), 300_000, true), play("b", at(9), 100_000)];
  const c = cat([meta("a", "Secret"), meta("b", "Real")]);
  const profile = tasteProfile(plays, c);
  assert.deepEqual(profile.topArtists.map((a) => a.name), ["Real"]);
  assert.equal(profile.totalMs, 100_000);
});

test("tag soup is split and short fragments dropped", () => {
  const plays = [play("a", at(8), 100_000)];
  const c = cat([meta("a", "Alpha", ["pop, indie-pop | alt", "x", "90s"])]);
  const tags = tasteProfile(plays, c).topTags.map((t) => t.tag);
  assert.ok(tags.includes("pop"));
  assert.ok(tags.includes("indie"));
  assert.ok(tags.includes("alt"));
  assert.ok(tags.includes("90s"));
  assert.ok(!tags.includes("x"), "single characters are noise, not a genre");
});

test("weekly seed is stable within a week and moves next week", () => {
  const monday = new Date(2026, 5, 1);
  const friday = new Date(2026, 5, 5);
  const nextMonday = new Date(2026, 5, 8);
  assert.equal(weeklySeed(monday), weeklySeed(friday), "same week must not reshuffle");
  assert.notEqual(weeklySeed(monday), weeklySeed(nextMonday), "next week should change");
});

test("seeded random is reproducible and in range", () => {
  const a = seededRandom(12345);
  const b = seededRandom(12345);
  for (let i = 0; i < 50; i++) {
    const v = a();
    assert.equal(v, b(), "same seed must give the same sequence");
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test("weekly picks are stable, bounded and unique", () => {
  const tracks = Array.from({ length: 60 }, (_, i) => meta(`t${i}`, `Artist ${i % 6}`));
  const c = cat(tracks);
  const plays = tracks.slice(0, 30).map((t, i) => play(t.key, at(8 + (i % 12)), 180_000));

  const now = new Date(2026, 5, 3);
  const first = weeklyPicks(c, plays, now, 15);
  const second = weeklyPicks(c, plays, now, 15);

  assert.equal(first.length, 15);
  assert.deepEqual(first.map((t) => t.key), second.map((t) => t.key), "same week, same shelf");
  assert.equal(new Set(first.map((t) => t.key)).size, 15, "no duplicates");

  const later = weeklyPicks(c, plays, new Date(2026, 5, 10), 15);
  assert.notDeepEqual(first.map((t) => t.key), later.map((t) => t.key), "a new week should differ");
});

test("weekly picks never exceed the catalogue size", () => {
  const c = cat([meta("a", "Alpha"), meta("b", "Beta")]);
  assert.equal(weeklyPicks(c, [], new Date(), 20).length, 2);
  assert.deepEqual(weeklyPicks(cat([]), [], new Date(), 20), []);
});

test("weekly picks still surface never-played tracks", () => {
  const tracks = Array.from({ length: 40 }, (_, i) => meta(`t${i}`, "A"));
  const c = cat(tracks);
  const played = tracks.slice(0, 5).map((t) => play(t.key, at(8), 180_000));
  const picks = weeklyPicks(c, played, new Date(2026, 5, 3), 20);
  assert.ok(picks.length > 5, "a shelf of only already-played tracks defeats the point");
});

test("release radar keeps only recent years and survives a failing source", async () => {
  const radar = await releaseRadar(
    ["Alpha", "Beta"],
    async (artist) => {
      if (artist === "Beta") throw new Error("source down");
      // Distinct album names: the radar dedupes on artist+album, so reusing
      // one album name would collapse these into a single entry.
      return [
        { ...meta("x", "Alpha", undefined, "2026"), album: "New" },
        { ...meta("y", "Alpha", undefined, "2019"), album: "Old" },
        { ...meta("z", "Alpha", undefined, String(new Date().getFullYear() - 1)), album: "Last Year" },
      ];
    },
  );
  assert.ok(radar.every((r) => Number(r.year) >= new Date().getFullYear() - 2), "old years filtered");
  assert.ok(!radar.some((r) => r.year === "2019"));
  assert.equal(radar.length, 2);
  assert.equal(radar[0].via, "album year", "should disclose how it was derived");
});

test("release radar dedupes by artist and album", async () => {
  const radar = await releaseRadar(
    ["Alpha"],
    async () => [meta("x", "Alpha", undefined, "2026"), meta("y", "Alpha", undefined, "2026")],
  );
  assert.equal(radar.length, 1, "same album twice is one entry");
});