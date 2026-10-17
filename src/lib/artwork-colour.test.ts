import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARTWORK_FALLBACK_BG,
  dominantColour,
  luminance,
} from "./artwork-colour.ts";

/** Builds a pixel buffer from a colour, repeated `count` times. */
function pixels(r: number, g: number, b: number, count = 1, alpha = 255): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = alpha;
  }
  return out;
}

function mix(a: [number, number, number], b: [number, number, number], n: number) {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out[i * 4] = Math.round(a[0] + (b[0] - a[0]) * t);
    out[i * 4 + 1] = Math.round(a[1] + (b[1] - a[1]) * t);
    out[i * 4 + 2] = Math.round(a[2] + (b[2] - a[2]) * t);
    out[i * 4 + 3] = 255;
  }
  return out;
}

test("luminance behaves as expected at the extremes", () => {
  assert.equal(luminance({ r: 255, g: 255, b: 255 }), 1);
  assert.ok(luminance({ r: 0, g: 0, b: 0 }) < 0.001);
  assert.ok(luminance({ r: 255, g: 0, b: 0 }) > 0 && luminance({ r: 255, g: 0, b: 0 }) < 0.3);
});

test("a flat image yields its own colour", () => {
  assert.equal(dominantColour(pixels(200, 60, 30, 40)), "#c83c1e");
});

test("an all-black image falls back rather than returning a black backdrop", () => {
  // A black Now Playing background makes the controls unreadable.
  assert.equal(dominantColour(pixels(0, 0, 0, 40)), ARTWORK_FALLBACK_BG);
  assert.equal(dominantColour(pixels(5, 5, 5, 40)), ARTWORK_FALLBACK_BG);
});

test("an all-white image falls back too", () => {
  assert.equal(dominantColour(pixels(255, 255, 255, 40)), ARTWORK_FALLBACK_BG);
});

test("a transparent image yields nothing to sample", () => {
  assert.equal(dominantColour(pixels(200, 60, 30, 40, 0)), ARTWORK_FALLBACK_BG);
});

test("empty input does not throw", () => {
  assert.equal(dominantColour(new Uint8ClampedArray(0)), ARTWORK_FALLBACK_BG);
});

test("the most common usable colour wins", () => {
  const data = new Uint8ClampedArray([
    // A little dark edge, which is ignored.
    10, 10, 10, 255,
    // The actual cover colour, repeated.
    ...pixels(40, 120, 200, 12),
  ]);
  assert.equal(dominantColour(data), "#2878c8");
});

test("saturation breaks a near-tie in favour of the vivid colour", () => {
  // Comparable areas of grey and pink: the saturated one should win, because
  // a flat grey backdrop wastes the colour the artwork actually leads with.
  const grey = [...pixels(120, 120, 120, 20)];
  const vivid = [...pixels(250, 40, 90, 14)];
  assert.equal(dominantColour(new Uint8ClampedArray([...grey, ...vivid])), "#fa285a");
});

test("a decisive majority still wins, however flat", () => {
  // Deliberately not saturation-dominated: an overwhelmingly grey cover
  // should give a grey backdrop. Overriding that would make the result
  // surprising, and predicting it is the whole point of picking a dominant
  // colour rather than an average one.
  const grey = [...pixels(120, 120, 120, 60)];
  const vivid = [...pixels(250, 40, 90, 14)];
  assert.equal(dominantColour(new Uint8ClampedArray([...grey, ...vivid])), "#787878");
});

test("a gradient resolves to something in the middle of its range", () => {
  const hex = dominantColour(mix([200, 30, 30], [30, 30, 200], 200));
  const r = parseInt(hex.slice(1, 3), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  assert.ok(r > 30 && r < 200, `red ${r} should be inside the gradient`);
  assert.ok(b > 30 && b < 200, `blue ${b} should be inside the gradient`);
});

test("the result is always a valid 6-digit hex", () => {
  for (const data of [pixels(17, 200, 90), pixels(240, 240, 30), mix([0,255,0],[255,0,0], 50)]) {
    assert.match(dominantColour(data), /^#[0-9a-f]{6}$/);
  }
});

test("a mid-grey image is still usable", () => {
  // Grey has no saturation, but count alone should still carry it through.
  assert.equal(dominantColour(pixels(128, 128, 128, 40)), "#808080");
});