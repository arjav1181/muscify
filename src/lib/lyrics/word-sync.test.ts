import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeWordIndex,
  buildWordTimings,
  interpolateWords,
  splitWords,
  wordProgress,
} from "./word-sync.ts";

test("splits words while keeping punctuation attached", () => {
  assert.deepEqual(splitWords("So the bar is where I go (mm-mm)"), [
    "So",
    "the",
    "bar",
    "is",
    "where",
    "I",
    "go",
    "(mm-mm)",
  ]);
  assert.deepEqual(splitWords("   "), []);
});

test("words fill the line span exactly, in order", () => {
  const out = interpolateWords({ time: 10, text: "one two three four" }, 0, 14);
  assert.equal(out.length, 4);
  assert.equal(out[0]!.start, 10);
  assert.ok(Math.abs(out[3]!.end - 14) < 1e-6, "last word should reach the next line");
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i]!.start >= out[i - 1]!.start, "timings must not go backwards");
    assert.ok(out[i]!.start <= out[i]!.end + 1e-9);
  }
});

test("longer words get proportionally more time", () => {
  const out = interpolateWords({ time: 0, text: "a extraordinary" }, 0, 4);
  const shortWord = out.find((w) => w.word === "a")!;
  const longWord = out.find((w) => w.word === "extraordinary")!;
  assert.ok(
    longWord.end - longWord.start > shortWord.end - shortWord.start,
    "a long word should last longer than a short one",
  );
});

test("a readable minimum applies when the line span can afford it", () => {
  // 10 words over 4s: 0.12s each is affordable, so the floor should hold.
  const text = Array.from({ length: 10 }, () => "a").join(" ");
  const out = interpolateWords({ time: 0, text }, 0, 4);
  assert.equal(out.length, 10);
  for (const w of out) {
    assert.ok(w.end - w.start >= 0.12 - 1e-9, `word too brief: ${w.end - w.start}`);
  }
  assert.ok(Math.abs(out.at(-1)!.end - 4) < 1e-6, "floored words still fill the span exactly");
});

test("an unaffordable span degrades proportionally instead of overrunning", () => {
  // 100 one-character words across 1s cannot each get 120ms — that needs 12s.
  // The line must still end on time rather than run 12s past the next line.
  const words = Array.from({ length: 100 }, () => "a").join(" ");
  const out = interpolateWords({ time: 0, text: words }, 0, 1);
  assert.ok(Math.abs(out.at(-1)!.end - 1) < 1e-6, "must not overrun the line span");
  assert.ok(out.every((w) => w.end > w.start), "every emitted word is reachable");
});

test("a long line is capped rather than leaving the last word hanging", () => {
  const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const out = interpolateWords({ time: 0, text }, 0, 600);
  assert.ok(out[out.length - 1]!.end <= 40 * 1.4 + 1e-6, "should be capped");
});

test("a final line with no successor uses a bounded default span", () => {
  const out = interpolateWords({ time: 100, text: "a b c d e f g h i j" }, 0, null);
  assert.equal(out.length, 10);
  assert.ok(out[out.length - 1]!.end < 100 + 60, "must not run away");
});

test("empty and whitespace lines produce nothing", () => {
  assert.deepEqual(interpolateWords({ time: 0, text: "   " }, 0, 5), []);
  assert.deepEqual(interpolateWords({ time: 0, text: "" }, 0, 5), []);
});

test("buildWordTimings spans a whole track and carries line indices", () => {
  const lines = [
    { time: 0, text: "first line here" },
    { time: 3, text: "second line" },
    { time: 6, text: "third" },
  ];
  const timings = buildWordTimings(lines);
  assert.equal(timings.length, 6);
  assert.equal(timings[0]!.lineIndex, 0);
  assert.equal(timings.at(-1)!.lineIndex, 2);
  assert.ok(timings.at(-1)!.end <= 6 + 4 + 1e-6);
});

test("an empty track yields no timings", () => {
  assert.deepEqual(buildWordTimings([]), []);
});

test("active word is found by position and gaps report none", () => {
  const timings = buildWordTimings([
    { time: 0, text: "alpha beta" },
    { time: 4, text: "gamma" },
  ]);
  assert.equal(activeWordIndex(timings, 0), 0);
  assert.equal(activeWordIndex(timings, 2), 1, "second word of the first line");
  assert.equal(activeWordIndex(timings, -5), -1, "before the first word");
  // The final word's span is a default 4s, so 4s is the start of line 2's word.
  assert.ok(activeWordIndex(timings, 4) > 0);
  assert.equal(activeWordIndex([], 1), -1);
});

test("word progress is clamped and monotonic", () => {
  const timing = { word: "x", start: 10, end: 12, lineIndex: 0 };
  assert.equal(wordProgress(timing, 10), 0);
  assert.equal(wordProgress(timing, 11), 0.5);
  assert.equal(wordProgress(timing, 12), 1);
  assert.equal(wordProgress(timing, 9), 0, "before the word clamps to 0");
  assert.equal(wordProgress(timing, 99), 1, "after the word clamps to 1");
  assert.equal(wordProgress({ ...timing, start: 5, end: 5 }, 5), 1, "zero span is complete");
});