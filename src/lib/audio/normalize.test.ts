import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createNormalizer,
  dbToGain,
  describeNormalization,
  gainFor,
  rmsToDb,
  updateReference,
} from "./normalize.ts";

test("rms converts to dBFS and silence stays finite", () => {
  assert.equal(Math.round(rmsToDb(1)), 0, "full scale is 0 dBFS");
  assert.ok(Math.abs(rmsToDb(0.5) - -6.02) < 0.01, "half amplitude is about -6 dB");
  assert.ok(Number.isFinite(rmsToDb(0)), "silence must not be -Infinity or NaN");
});

test("no gain without a reference", () => {
  assert.equal(gainFor(0.5, null), 0);
  assert.equal(gainFor(0.5, 0), 0, "a zero reference is not usable");
});

test("a track at the reference level is untouched", () => {
  assert.equal(gainFor(0.3, 0.3), 0);
});

test("small differences fall inside the deadband", () => {
  // ~3% amplitude is under 2 dB, so no correction should be applied.
  assert.equal(gainFor(0.31, 0.3), 0);
});

test("a loud track is trimmed and a quiet one is raised", () => {
  const loud = gainFor(0.6, 0.3);
  const quiet = gainFor(0.15, 0.3);
  assert.ok(loud < 0, "louder than reference means negative gain");
  assert.ok(quiet > 0, "quieter than reference means positive gain");
  assert.ok(Math.abs(loud) > 0 && Math.abs(quiet) > 0, "both should actually correct");
});

test("gain is bounded so dynamics are not destroyed", () => {
  // 1000x too loud would be 60 dB without a bound.
  assert.ok(gainFor(300, 0.3) >= -9, `should floor at -9 dB, got ${gainFor(300, 0.3)}`);
  assert.ok(gainFor(0.0003, 0.3) <= 9, `should cap at +9 dB, got ${gainFor(0.0003, 0.3)}`);
});

test("the reference follows the signal with exponential decay", () => {
  let ref: number | null = null;
  ref = updateReference(ref, 0.5);
  assert.equal(ref, 0.5, "first reading seeds the reference");
  ref = updateReference(ref, 0.5);
  assert.ok(Math.abs(ref! - 0.5) < 1e-9, "same input should be a fixed point");
  ref = updateReference(ref, 1.0);
  assert.ok(ref! > 0.5 && ref! < 1.0, "should move toward the new value, not jump");
});

test("the reference survives invalid measurements", () => {
  const ref = updateReference(0.5, 0);
  assert.equal(ref, 0.5, "silence must not drag the reference down");
  assert.equal(updateReference(null, 0), null, "no reference from silence alone");
  assert.equal(updateReference(0.5, Number.NaN), 0.5);
});

test("normalizer instance observes and reports gain", () => {
  const n = createNormalizer();
  assert.equal(n.reference, null);
  assert.equal(n.observe(0.3), 0, "first measurement defines the reference");

  n.observe(0.3);
  const loud = n.observe(0.6);
  assert.ok(loud < 0, "a doubled-amplitude track should be trimmed");
  assert.ok(n.current() < 0, "current() should report the trim for that track");

  n.reset();
  assert.equal(n.reference, null, "reset clears what was learned");
});

test("dB converts to element gain", () => {
  assert.equal(dbToGain(0), 1);
  assert.ok(Math.abs(dbToGain(-6) - 0.501) < 0.01);
  assert.ok(dbToGain(6) > 1);
});

test("the description states the real limitation", () => {
  const text = describeNormalization();
  assert.match(text, /radio only/i);
  assert.ok(text.length > 40, "should say something meaningful");
});