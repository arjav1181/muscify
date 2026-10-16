/**
 * Tempo estimation from an onset-strength envelope.
 *
 * Deliberately free of Web Audio so the signal processing can be tested
 * against synthetic signals with known answers. `analyser.ts` owns the audio
 * graph and feeds this class one mean-centred flux value per tick.
 */

const TICK_MS = 33;
const BPM_MIN = 60;
const BPM_MAX = 200;

/** Below this confidence the estimate is withheld rather than guessed. */
const MIN_CONFIDENCE = 0.12;

/** Fraction of the window that must be filled before reporting anything. */
const MIN_FILL = 0.5;

export interface TempoEstimate {
  /** BPM, or null when not yet confident. */
  bpm: number | null;
  /** 0..1 — peak prominence blended with separation from the runner-up. */
  confidence: number;
}

/** Log-normal perceptual tempo weight centred on 120 BPM. */
function tempoPrior(bpm: number): number {
  const d = Math.log2(bpm / 120);
  return Math.exp(-0.5 * (d * d) / (0.9 * 0.9));
}

export class TempoEstimator {
  private env: Float32Array;
  private head = 0;
  private filled = 0;
  private scratch: Float32Array;

  constructor(windowMs = 12_000) {
    const len = Math.ceil(windowMs / TICK_MS);
    this.env = new Float32Array(len);
    this.scratch = new Float32Array(len);
  }

  /** Adds one tick's mean-centred onset strength. */
  push(centredFlux: number): void {
    this.env[this.head] = centredFlux;
    this.head = (this.head + 1) % this.env.length;
    if (this.filled < this.env.length) this.filled++;
  }

  /** Discards history — call on track change so tempo cannot bleed across. */
  reset(): void {
    this.env.fill(0);
    this.head = 0;
    this.filled = 0;
  }

  /**
   * Autocorrelates the envelope and returns the strongest periodic component.
   *
   * One sample per tick means a beat period of L ticks is simply a lag of L,
   * so the search is a couple of dozen lag correlations over a few hundred
   * samples — cheap enough to run every tick, unlike scoring candidate BPMs
   * against an explicit beat grid.
   */
  estimate(): TempoEstimate {
    const n = this.filled;
    if (n < this.env.length * MIN_FILL) return { bpm: null, confidence: 0 };

    // Materialise the circular buffer oldest-first.
    const signal = this.scratch.subarray(0, n);
    const start = (this.head - n + this.env.length) % this.env.length;
    for (let i = 0; i < n; i++) signal[i] = this.env[(start + i) % this.env.length];

    // Mean-centre: without this the DC term dominates and every lag correlates
    // strongly, which reads as a confident but meaningless tempo.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += signal[i];
    mean /= n;
    for (let i = 0; i < n; i++) signal[i] -= mean;

    const minLag = Math.floor(60_000 / BPM_MAX / TICK_MS);
    const maxLag = Math.ceil(60_000 / BPM_MIN / TICK_MS);
    if (maxLag >= n) return { bpm: null, confidence: 0 };

    let sumAll = 0;
    let count = 0;
    const scores = new Float64Array(maxLag + 2);
    let bestLag = 0;
    let best = -Infinity;
    let second = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < n; i++) sum += signal[i] * signal[i + lag];

      // Normalise by overlap so long lags are not penalised merely for
      // covering more of the mostly-silent buffer.
      const score = (sum / (n - lag)) * tempoPrior(60_000 / (lag * TICK_MS));
      scores[lag] = score;

      sumAll += score;
      count++;
      if (score > best) {
        second = best;
        best = score;
        bestLag = lag;
      } else if (score > second) {
        second = score;
      }
    }

    if (bestLag === 0 || count === 0) return { bpm: null, confidence: 0 };

    // Ticks are 33ms apart, so quantising the peak to a whole tick caps BPM
    // accuracy at roughly one tick's worth of period error — about 6% at
    // 120 BPM. Parabolic interpolation across the peak recovers the sub-tick
    // position and removes most of that error.
    let refinedLag = bestLag;
    const left = scores[bestLag - 1];
    const mid = scores[bestLag];
    const right = scores[bestLag + 1];
    const denom = left - 2 * mid + right;
    if (denom !== 0 && Number.isFinite(denom)) {
      const shift = (0.5 * (left - right)) / denom;
      // A real peak sits within one lag of the maximum; anything further is
      // curvature noise, not a displaced peak.
      if (Math.abs(shift) <= 1) refinedLag = bestLag + shift;
    }

    const margin = best - sumAll / count;
    if (margin <= 0) return { bpm: null, confidence: 0 };

    // Prominence says "this stands out from the noise floor"; separation says
    // "this is not just its double or half-time reading". Both are needed —
    // prominence alone accepts half/double ambiguities, separation alone
    // accepts weak peaks.
    const scale = Math.abs(best) + 1e-9;
    const prominence = clamp01(margin / scale);
    const separation = clamp01((best - second) / scale);
    const confidence = clamp01(prominence * 0.5 + separation * 0.5);

    if (confidence < MIN_CONFIDENCE) return { bpm: null, confidence };
    return { bpm: round1(60_000 / (refinedLag * TICK_MS)), confidence };
  }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const TEMPO_TICK_MS = TICK_MS;