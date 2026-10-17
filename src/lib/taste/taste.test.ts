import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTasteFilter,
  artistAffinity,
  emptyTasteState,
  hide,
  isHiddenGlobally,
  isHiddenIn,
  isSnoozed,
  MAX_PLAY_EVENTS,
  PLAY_THRESHOLD_MS,
  pruneSnoozed,
  recordPlay,
  snooze,
  unhide,
  unsnooze,
  type PlayEvent,
} from "./taste.ts";
import { computeStats, percentile, summarise } from "./stats.ts";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

interface T {
  key: string;
  title: string;
  explicit?: boolean;
}

const t = (key: string, explicit?: boolean): T => ({ key, title: key, explicit });

test("play events below the threshold are not recorded", () => {
  let s = emptyTasteState();
  s = recordPlay(s, { key: "a", at: NOW, ms: 5_000 }, false);
  assert.equal(s.plays.length, 0, "a 5s skip should not count as a play");

  s = recordPlay(s, { key: "a", at: NOW, ms: PLAY_THRESHOLD_MS }, false);
  assert.equal(s.plays.length, 1, "exactly the threshold should count");
});

test("private session events are recorded but marked", () => {
  const s = recordPlay(emptyTasteState(), { key: "a", at: NOW, ms: 60_000 }, true);
  assert.equal(s.plays.length, 1, "playback history must survive a private session");
  assert.equal(s.plays[0].private, true);
});

test("play log is capped, dropping the oldest events", () => {
  let s = emptyTasteState();
  for (let i = 0; i < MAX_PLAY_EVENTS + 50; i++) {
    s = recordPlay(s, { key: `k${i}`, at: NOW + i * 1000, ms: 60_000 }, false);
  }
  assert.equal(s.plays.length, MAX_PLAY_EVENTS);
  assert.equal(s.plays[0].key, "k50", "oldest events should be trimmed first");
  assert.equal(s.plays.at(-1)!.key, `k${MAX_PLAY_EVENTS + 49}`, "newest kept");
});

test("hide is idempotent and scoped", () => {
  let s = emptyTasteState();
  s = hide(s, "x", "global");
  s = hide(s, "x", "global");
  assert.equal(s.hidden.length, 1, "hiding twice must not stack entries");
  assert.equal(s.hidden[0].scope, "global");

  s = hide(s, "x", "playlist:abc");
  assert.equal(s.hidden.length, 2, "a different scope is a separate entry");
});

test("a global hide applies everywhere; a scoped hide only in its context", () => {
  let s = emptyTasteState();
  s = hide(s, "g", "global");
  s = hide(s, "p", "playlist:abc");

  assert.equal(isHiddenGlobally(s, "g"), true);
  assert.equal(isHiddenIn(s, "g", "playlist:zzz"), true, "global hide wins everywhere");
  assert.equal(isHiddenIn(s, "p", "playlist:abc"), true);
  assert.equal(isHiddenIn(s, "p", "playlist:other"), false, "scoped hide stays scoped");
  assert.equal(isHiddenIn(s, "p", undefined), false, "no context means no scoped match");
});

test("unhide without a scope clears every scope", () => {
  let s = emptyTasteState();
  s = hide(s, "x", "global");
  s = hide(s, "x", "playlist:abc");
  s = unhide(s, "x");
  assert.equal(s.hidden.length, 0);
});

test("snooze suppresses until it expires, then lapses on its own", () => {
  const s = snooze(emptyTasteState(), "x", NOW);
  assert.equal(isSnoozed(s, "x", NOW), true);
  assert.equal(isSnoozed(s, "x", NOW + HOUR), true);
  assert.equal(isSnoozed(s, "x", NOW + 31 * 86_400_000), false, "30-day snooze should lapse");
});

test("re-snoozing replaces the clock rather than stacking entries", () => {
  let s = snooze(emptyTasteState(), "x", NOW);
  s = snooze(s, "x", NOW + HOUR);
  assert.equal(s.snoozed.length, 1);
  assert.equal(s.snoozed[0].until, NOW + HOUR + 30 * 86_400_000, "clock restarts");
  assert.equal(unsnooze(s, "x").snoozed.length, 0);
});

test("expired snoozes are pruned from storage", () => {
  const s = snooze(emptyTasteState(), "x", NOW);
  assert.equal(pruneSnoozed(s, NOW).snoozed.length, 1);
  assert.equal(pruneSnoozed(s, NOW + 31 * 86_400_000).snoozed.length, 0);
});

test("applyTasteFilter drops hidden, snoozed and explicit tracks", () => {
  let s = emptyTasteState();
  s = hide(s, "hidden", "global");
  s = snooze(s, "snoozed", NOW);

  const items = [t("keep"), t("hidden"), t("snoozed"), t("naughty", true)];
  const kept = applyTasteFilter(items, s, { now: NOW, excludeExplicit: true });

  assert.deepEqual(kept.map((x) => x.key), ["keep"]);
});

test("applyTasteFilter honours a context scope", () => {
  const s = hide(emptyTasteState(), "x", "playlist:abc");
  const items = [t("x"), t("y")];
  assert.equal(applyTasteFilter(items, s, { contextId: "playlist:abc", now: NOW }).length, 1);
  assert.equal(applyTasteFilter(items, s, { contextId: "playlist:other", now: NOW }).length, 2);
});

test("explicit filtering uses the resolver when the track omits the flag", () => {
  const s = emptyTasteState();
  const items = [t("unknown")];
  const kept = applyTasteFilter(items, s, {
    now: NOW,
    excludeExplicit: true,
    isExplicit: () => true,
  });
  assert.equal(kept.length, 0, "an unknown-flag track must still be checkable");
});

test("affinity rewards non-private plays and penalises suppression", () => {
  let s = emptyTasteState();
  s = recordPlay(s, { key: "good", at: NOW, ms: 200_000 }, false);
  s = recordPlay(s, { key: "secret", at: NOW, ms: 200_000 }, true);
  s = hide(s, "bad");

  const scores = artistAffinity(s, NOW);
  assert.ok(scores.get("good")! > 0, "a full listen should score positive");
  assert.equal(scores.get("secret"), undefined, "private listens must not shape taste");
  assert.ok(scores.get("bad")! < 0, "hiding should create an aversion");
});

// ---------------------------------------------------------------- stats

const resolver = (key: string) => {
  const [artist, secs] = key.split(":");
  return { artist: artist!, durationMs: secs ? Number(secs) * 1000 : undefined };
};

function events(list: [string, number, number, boolean?][]): PlayEvent[] {
  return list.map(([key, at, ms, priv]) => ({ key, at, ms, private: priv ?? false }));
}

test("stats exclude private sessions but count them as excluded", () => {
  const stats = computeStats(
    events([
      ["A:180", NOW, 180_000],
      ["B:200", NOW + HOUR, 200_000, true],
      ["C:90", NOW + 2 * HOUR, 90_000],
    ]),
    resolver,
  );
  assert.equal(stats.plays, 2, "private play excluded from totals");
  assert.equal(stats.privateExcluded, 1);
  assert.equal(stats.totalMs, 270_000);
});

test("stats rank by listened time and join tracks to artists", () => {
  const stats = computeStats(
    events([
      ["A:180", NOW, 100_000],
      ["B:200", NOW, 300_000],
      ["A:180", NOW + HOUR, 50_000],
    ]),
    resolver,
  );
  assert.equal(stats.topArtists[0].name, "B", "most-listened artist leads");
  assert.equal(stats.topArtists[0].plays, 1);
  const a = stats.topArtists.find((x) => x.name === "A")!;
  assert.equal(a.plays, 2);
  assert.equal(a.tracks, 1, "two plays of one track is still one distinct track");
  assert.equal(stats.uniqueTracks, 2);
  assert.equal(stats.uniqueArtists, 2);
});

test("hour histogram and daily series reflect the log", () => {
  const morning = new Date(2026, 2, 4, 9, 30).getTime();
  const evening = new Date(2026, 2, 4, 21, 15).getTime();
  const stats = computeStats(events([["A:180", morning, 60_000], ["A:180", evening, 60_000]]), resolver);

  assert.equal(stats.byHour[9], 1);
  assert.equal(stats.byHour[21], 1);
  assert.equal(stats.byHour[3], 0);
  assert.equal(stats.byDay.length, 1, "same local day collapses to one point");
  assert.equal(stats.byDay[0].plays, 2);
});

test("completion uses known durations and ignores unknown ones", () => {
  const stats = computeStats(
    events([
      ["A:100", NOW, 100_000], // complete
      ["A:100", NOW, 50_000], // half
      ["X", NOW, 999_999], // no duration known
    ]),
    resolver,
  );
  // 150000 listened of 200000 total across two duration-bearing events.
  assert.equal(stats.completion, 0.75);
});

test("empty history yields zeroes rather than NaN", () => {
  const stats = computeStats([], resolver);
  assert.equal(stats.totalMs, 0);
  assert.equal(stats.completion, 0);
  assert.equal(stats.byHour.length, 24);
  assert.deepEqual(stats.topTracks, []);
  assert.equal(percentile(0, 0), 0);
  assert.equal(summarise(stats), "0 minutes across 0 plays");
});

test("summarise names the top artist when there is one", () => {
  const stats = computeStats(events([["A:180", NOW, 60_000], ["B:200", NOW, 120_000]]), resolver);
  const line = summarise(stats);
  assert.match(line, /most played: B/);
});