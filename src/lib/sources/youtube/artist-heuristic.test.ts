import { test } from "node:test";
import assert from "node:assert/strict";

import { filterArtistCandidates, looksLikeArtistName } from "./artist-heuristic.ts";

/**
 * These names are the real production output of `type=channel` search for
 * "pritam", captured from the live deployment. They are the test fixtures
 * because inventing cleaner ones would have hidden the failure.
 */
const REAL_CHANNEL_RESULTS = [
  "Pritam - Topic",
  "Pritam Officeal61",
  "Pritam Bhartwan Official Channel",
  "PRITAM GAMER ",
  "KAVI PRITAM RITU",
  "Only MÃTHEMATICS (by Pritam)",
  "Pritam Bhartwan - Topic",
  "Pritam Holme Chowdhury",
];

test("rejects auto-generated topic channels", () => {
  // The single most damaging false positive: an archive of uploads that reads
  // exactly like the artist's page.
  assert.equal(looksLikeArtistName("Pritam - Topic"), false);
  assert.equal(looksLikeArtistName("Pritam Bhartwan - Topic"), false);
  assert.equal(looksLikeArtistName("pritam - TOPIC"), false, "case must not matter");
});

test("does not reject a real artist whose name merely contains 'topic'", () => {
  assert.equal(looksLikeArtistName("Topic"), true);
  assert.equal(looksLikeArtistName("Topic Sons"), true);
});

test("rejects typo'd and handle-shaped names", () => {
  assert.equal(looksLikeArtistName("Pritam Officeal61"), false, "trailing counter");
  assert.equal(looksLikeArtistName("some_band_99"), false, "handle, no spaces");
});

test("accepts ordinary artist names", () => {
  for (const name of [
    "Pritam",
    "Arijit Singh",
    "The Beatles",
    "KAVI PRITAM RITU",
    "Pritam Holme Chowdhury",
    "Yo Yo Honey Singh",
    "Diljit Dosanjh",
  ]) {
    assert.equal(looksLikeArtistName(name), true, name);
  }
});

test("rejects empty names", () => {
  assert.equal(looksLikeArtistName(""), false);
  assert.equal(looksLikeArtistName("   "), false);
});

test("an exact name outranks one that merely contains the query", () => {
  // Note the fixture needs an actual exact match. The production set below has
  // none — every row there contains "pritam" without being it — so it falls
  // through to the shortest-first tiebreak, which is the intended behaviour.
  const filtered = filterArtistCandidates(
    [
      { title: "Only Mathematics (by Pritam)" },
      { title: "Pritam" },
      { title: "Pritam Bhartwan Official Channel" },
    ],
    "pritam",
  );
  assert.equal(filtered[0]!.title, "Pritam");
  assert.ok(
    filtered.findIndex((c) => c.title === "Pritam") <
      filtered.findIndex((c) => c.title.includes("Mathematics")),
    "the exact name must come first",
  );
});

test("with no exact match, the shortest plausible name leads", () => {
  // Every row in the production set contains the query without equalling it.
  const filtered = filterArtistCandidates(
    REAL_CHANNEL_RESULTS.map((title) => ({ title })),
    "pritam",
  );
  const lengths = filtered.map((c) => c.title.trim().length);
  assert.deepEqual(
    lengths,
    [...lengths].sort((a, b) => a - b),
    "shortest first when nothing matches exactly",
  );
});

test("decorations do not stop a name from matching the query exactly", () => {
  const filtered = filterArtistCandidates(
    [
      { title: "Pritam Official Channel" },
      { title: "Pritam Live from London" },
    ],
    "pritam",
  );
  // "Official Channel" is stripped for comparison, so it ties with the bare name
  // on equality and then loses on length. That is the intended order: the
  // decorated name is a plausible artist page, the live-session channel less so.
  assert.equal(filtered[0]!.title, "Pritam Official Channel");
  assert.equal(filtered[1]!.title, "Pritam Live from London");
});

test("the production result set yields only plausible artists", () => {
  const filtered = filterArtistCandidates(
    REAL_CHANNEL_RESULTS.map((title) => ({ title })),
    "pritam",
  );
  const names = filtered.map((c) => c.title.trim());

  for (const rejected of [
    "Pritam - Topic",
    "Pritam Bhartwan - Topic",
    "Pritam Officeal61",
  ]) {
    assert.equal(names.includes(rejected), false, `${rejected} must not be offered as an artist`);
  }
  assert.ok(names.includes("Pritam Holme Chowdhury"));
  assert.ok(names.includes("KAVI PRITAM RITU"));
});

test("filtering is stable and does not mutate the input", () => {
  const input = REAL_CHANNEL_RESULTS.map((title) => ({ title }));
  const before = input.map((i) => i.title);
  filterArtistCandidates(input, "pritam");
  assert.deepEqual(input.map((i) => i.title), before);
});

test("an empty result set is not a crash", () => {
  assert.deepEqual(filterArtistCandidates([], "pritam"), []);
});
test("subscriber count separates an exact match that is the artist", () => {
  // The two situations tier 1 cannot distinguish: both names equal the query.
  // Before follower counts were fetched this returned them in alphabetical
  // accident, putting "PRITAM GAMER" second for "pritam".
  const filtered = filterArtistCandidates(
    [
      { title: "PRITAM GAMER", followers: 312 },
      { title: "Pritam", followers: 4_800_000 },
    ],
    "pritam",
  );
  assert.equal(filtered[0]!.title, "Pritam");
});

test("followers break a tie only within the same match tier", () => {
  const filtered = filterArtistCandidates(
    [
      { title: "Pritam Live Sessions", followers: 9_000_000 },
      { title: "Pritam", followers: 100 },
    ],
    "pritam",
  );
  // The exact match still wins: a huge channel that merely contains the query
  // is weaker evidence than a small one that equals it.
  assert.equal(filtered[0]!.title, "Pritam");
});

test("a missing follower count does not throw and is treated as zero", () => {
  const filtered = filterArtistCandidates(
    [
      { title: "Pritam And The Pals", followers: 900 },
      { title: "Pritam And The Ensemble" },
      { title: "Pritam And The Duo" },
    ],
    "pritam and the",
  );
  // All three tie on tier 1 — none equals the query — so follower count decides,
  // and the two with no count must sort as zero rather than NaN, which would
  // make every comparison false and leave the order up to chance. Lengths are
  // deliberately different so the third tier is not a tie.
  assert.equal(filtered.length, 3);
  assert.equal(filtered[0]!.title, "Pritam And The Pals");
  assert.equal(filtered[1]!.title, "Pritam And The Duo");
  assert.equal(filtered[2]!.title, "Pritam And The Ensemble");
});
