import { test } from "node:test";
import assert from "node:assert/strict";
import { stationArtStyle, stationInitials, artFallback } from "./art.ts";

test("initials come from the meaningful words", () => {
  assert.equal(stationInitials("Radio City FM"), "RC");
  assert.equal(stationInitials("Groove Salad"), "GS");
  assert.equal(stationInitials("BBC Radio 1"), "B1");
});

test("protocol words are dropped wherever they appear", () => {
  // "Boom FM" becomes "Boom", so the initials are the station's own name
  // rather than the band it broadcasts on.
  assert.equal(stationInitials("Boom FM"), "BO");
  // Stripping mid-name matters: "BBC Radio 1" should read as BBC1, not "BR".
  assert.equal(stationInitials("BBC Radio 1"), "B1");
});

test("a single-word name falls back sensibly", () => {
  assert.equal(stationInitials("Groove"), "GR", "first two letters when longer than one");
  assert.equal(stationInitials("X"), "X", "a one-letter name stays one letter");
});

test("punctuation and symbols do not break it", () => {
  // A frequency prefix splits into numeric words, so "94 1 The Beat" yields
  // the first two of them. Stable and readable, which is the requirement.
  assert.equal(stationInitials("94.1 The Beat"), "91");
  assert.match(stationInitials("!!! ???"), /^.+$/, "symbols alone still yield something");
});

test("an empty or unusable name still yields something", () => {
  assert.equal(stationInitials(""), "♪");
  assert.equal(stationInitials("   "), "♪");
  assert.equal(stationInitials("..."), "♪");
});

test("numbers count as words", () => {
  // "Radio" is interior with two words either side, so the documented rule
  // removes it and the initials follow from what remains.
  assert.equal(stationInitials("Radio 1 X"), "1X");
  assert.equal(stationInitials("Channel 4 Music"), "4M", "the channel number identifies it");
});

test("the same station always gets the same gradient", () => {
  const a = stationArtStyle("Groove Salad");
  const b = stationArtStyle("Groove Salad");
  assert.deepEqual(a, b, "artwork must be stable across renders");
  assert.match(a.background, /^linear-gradient\(/);
});

test("different stations get different gradients", () => {
  assert.notEqual(
    stationArtStyle("Groove Salad").background,
    stationArtStyle("Drone Zone").background,
  );
});

test("generated art is a gradient, not a flat fill", () => {
  // A flat swatch is what made missing logos look like a broken image.
  assert.match(stationArtStyle("Anything").background, /linear-gradient/);
});

test("generated text colour is legible on the gradient", () => {
  assert.equal(stationArtStyle("Anything").color, "#f2f2f2");
});

test("artFallback stays deterministic", () => {
  assert.equal(artFallback({ id: "a1", title: "Song" }), artFallback({ id: "a1", title: "Song" }));
  assert.notEqual(artFallback({ id: "a1", title: "Song" }), artFallback({ id: "a2", title: "Song" }));
  assert.equal(artFallback(null), artFallback({ id: "", title: "" }));
});