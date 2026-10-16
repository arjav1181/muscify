import { test } from "node:test";
import assert from "node:assert/strict";
import { TempoEstimator, TEMPO_TICK_MS } from "./tempo.ts";

/**
 * Feeds a synthetic click track and returns the settled estimate.
 *
 * Onsets are impulses at the target period with light jitter, which is what the
 * spectral-flux detector produces from a real percussive source.
 */
function estimateFromClicks(bpm: number, seconds = 14, jitterMs = 6) {
  const est = new TempoEstimator(12_000);
  const periodMs = 60_000 / bpm;
  const ticks = Math.round((seconds * 1000) / TEMPO_TICK_MS);
  let nextOnset = 0;

  for (let i = 0; i < ticks; i++) {
    const t = i * TEMPO_TICK_MS;
    // Deterministic jitter — a fixed LCG keeps the test reproducible.
    let flux = 0.001;
    if (t >= nextOnset) {
      flux = 1;
      nextOnset =
        t + periodMs + jitterMs > 0
          ? t + periodMs + (((i * 37) % (2 * jitterMs + 1)) - jitterMs)
          : t + periodMs;
    }
    est.push(Math.max(0, flux - 0.001));
  }
  return est.estimate();
}

/**
 * Accuracy is resolution-bound, not algorithm-bound.
 *
 * The envelope is sampled once per TICK_MS, so a beat period can only be
 * located to about one tick. That error is a fixed *fraction of the period*,
 * which means the tolerance has to scale with tempo — 33ms is 6.6% of a
 * 500ms period at 120 BPM but 11% of a 300ms period at 200 BPM.
 *
 * Real beat-synced features therefore drive off the real-time `beat` onset
 * flag, which is accurate per-event, rather than off this averaged estimate.
 */
function toleranceFor(target: number): number {
  const periodMs = 60_000 / target;
  // 1.2 ticks: the allowance for sub-tick peak interpolation.
  return Math.max(0.05, (TEMPO_TICK_MS * 1.2) / periodMs);
}

function expectNear(actual: number | null, target: number) {
  const tol = toleranceFor(target);
  assert.notEqual(actual, null, `no estimate for ${target} BPM`);
  const error = Math.abs(actual! - target) / target;
  assert.ok(
    error <= tol,
    `expected ${target} BPM within ${(tol * 100).toFixed(1)}% (got ${actual}, ${(error * 100).toFixed(1)}% off)`,
  );
}

test("detects a 120 BPM click track", () => {
  const { bpm, confidence } = estimateFromClicks(120);
  expectNear(bpm, 120);
  assert.ok(confidence > 0.3, `expected confident estimate, got ${confidence}`);
});

test("detects across the supported tempo range", () => {
  for (const target of [70, 90, 110, 128, 150, 175]) {
    expectNear(estimateFromClicks(target).bpm, target);
  }
});

test("prefers the true tempo over its half-time reading", () => {
  // The half-time reading is always at least as correlated as the real one,
  // so this is where a broken tempo prior shows up.
  const { bpm } = estimateFromClicks(150);
  assert.notEqual(bpm, null);
  const halved = Math.abs(bpm! - 75) / 75;
  const real = Math.abs(bpm! - 150) / 150;
  assert.ok(real <= halved, `expected 150 rather than 75, got ${bpm}`);
});

test("returns null before the window is full", () => {
  const est = new TempoEstimator(12_000);
  for (let i = 0; i < 40; i++) est.push(0.5);
  assert.equal(est.estimate().bpm, null, "must not guess from a short window");
});

test("returns null for silence rather than inventing a tempo", () => {
  const est = new TempoEstimator(12_000);
  for (let i = 0; i < 400; i++) est.push(0);
  assert.equal(est.estimate().bpm, null, "silence must not yield a tempo");
});

test("reset clears history so tempo cannot bleed across tracks", () => {
  const est = new TempoEstimator(12_000);
  const periodMs = 60_000 / 140;
  let next = 0;
  for (let i = 0; i < 400; i++) {
    const t = i * TEMPO_TICK_MS;
    est.push(t >= next ? 1 : 0);
    if (t >= next) next = t + periodMs;
  }
  assert.ok(est.estimate().bpm !== null, "precondition: has an estimate");

  est.reset();
  assert.equal(est.estimate().bpm, null, "reset must drop the window");
});