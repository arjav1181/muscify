import { test } from "node:test";
import assert from "node:assert/strict";
import { describeIntent, intentToQueries, parsePrompt } from "./prompt.ts";

test("detects a mood and applies its tempo/energy defaults", () => {
  const intent = parsePrompt("something for the gym");
  assert.deepEqual(intent.moods, ["workout"]);
  assert.ok(intent.minTempo! >= 128, "workout should imply a high tempo floor");
  assert.ok(intent.maxEnergy! >= 0.65);
});

test("an explicit tempo phrase overrides the mood default", () => {
  const withDefault = parsePrompt("party music");
  assert.ok(withDefault.minTempo! >= 120);

  const overridden = parsePrompt("party music but slow");
  assert.ok(overridden.minTempo! <= 95, `expected a slow floor, got ${overridden.minTempo}`);
});

test("explicit energy phrases are read", () => {
  const intent = parsePrompt("high energy bhangra to dance to");
  assert.ok(intent.minEnergy! >= 0.7);
  assert.deepEqual(intent.languages, ["punjabi"]);
});

test("named artists are extracted from an explicit request", () => {
  const intent = parsePrompt("something like Arijit Singh for a rainy evening");
  assert.ok(
    intent.artists.some((a) => /Arijit Singh/i.test(a)),
    `expected Arijit Singh, got ${JSON.stringify(intent.artists)}`,
  );
});

test("mid-sentence capitalised names are treated as artists", () => {
  const intent = parsePrompt("play some Divine and also AP Dhillon tracks");
  assert.ok(intent.artists.some((a) => /Divine/.test(a)), "Divine should be found");
  assert.ok(intent.artists.some((a) => /AP Dhillon/.test(a)), "AP Dhillon should be found");
});

test("an all-lowercase prompt does not invent artists from capitals", () => {
  const intent = parsePrompt("chill lofi beats");
  assert.deepEqual(intent.artists, [], "no capitals means no name signal");
});

test("years are read in both full and decade form", () => {
  assert.deepEqual(parsePrompt("songs from 2019").years, [2019]);
  assert.ok(parsePrompt("90s bollywood").years.includes(1990));
  assert.ok(parsePrompt("2000s pop").years.includes(2000));
});

test("language cues map, including regional ones", () => {
  assert.deepEqual(parsePrompt("hindi songs").languages, ["hindi"]);
  assert.deepEqual(parsePrompt("bollywood hits").languages, ["hindi"], "bollywood implies hindi");
  assert.deepEqual(parsePrompt("punjabi bhangra").languages, ["punjabi"]);
  assert.deepEqual(parsePrompt("kpop").languages, ["korean"]);
});

test("an unrecognisable prompt reports low coverage instead of guessing", () => {
  const intent = parsePrompt("wibble wobble flurb");
  assert.ok(intent.coverage < 0.15, `expected low coverage, got ${intent.coverage}`);
  assert.match(describeIntent(intent), /didn't recognise much/);
});

test("an empty prompt is handled without throwing", () => {
  const intent = parsePrompt("");
  assert.equal(intent.coverage, 0);
  assert.deepEqual(intent.moods, []);
  assert.deepEqual(intent.artists, []);
  assert.deepEqual(intentToQueries(intent), []);
});

test("free-text terms survive alongside a mood", () => {
  const intent = parsePrompt("chill lofi beats to study");
  assert.ok(intent.terms.includes("lofi"), `expected lofi in ${JSON.stringify(intent.terms)}`);
});

test("moods are ordered by where they appear, not by vocabulary order", () => {
  // "chill" is listed last in the table but is what was asked for first, so it
  // should lead — and leading decides the tempo/energy defaults.
  const intent = parsePrompt("chill lofi beats to study");
  assert.equal(intent.moods[0], "chill", "first-mentioned mood should lead");
  assert.ok(intent.moods.includes("focus"), "the second mood is still detected");
  assert.ok(intent.maxTempo! <= 118, `chill defaults should apply, got ${intent.maxTempo}`);
});

test("queries lead with a named artist when there is one", () => {
  const queries = intentToQueries(parsePrompt("romantic songs like Arijit Singh"));
  assert.ok(/Arijit/i.test(queries[0]), `artist should lead, got ${JSON.stringify(queries)}`);
});

test("queries are de-duplicated, trimmed and bounded", () => {
  const queries = intentToQueries(parsePrompt("chill hindi chill hindi"), 3);
  assert.ok(queries.length <= 3);
  assert.equal(new Set(queries).size, queries.length);
  assert.ok(queries.every((q) => q.trim() === q && q.length > 0));
});

test("describeIntent names what it understood", () => {
  const line = describeIntent(parsePrompt("punjabi bhangra for the gym at 140 bpm"));
  assert.match(line, /Understood/);
  assert.match(line, /punjabi|workout|gym/i);
});

test("a prompt mixing several signals resolves them together", () => {
  const intent = parsePrompt("old 90s hindi songs like Arijit Singh for a chill evening");
  assert.ok(intent.moods.includes("chill"));
  assert.ok(intent.languages.includes("hindi"));
  assert.ok(intent.years.includes(1990));
  assert.ok(intent.artists.length > 0);
  assert.ok(intent.coverage > 0.5, `expected good coverage, got ${intent.coverage}`);
});

test("coverage rises with how much of the prompt is understood", () => {
  const specific = parsePrompt("punjabi bhangra for the gym");
  const vague = parsePrompt("zzz qqq xxx");
  assert.ok(specific.coverage > vague.coverage);
});