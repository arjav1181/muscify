/**
 * In-browser audio feature extraction.
 *
 * Spotify retired `/audio-features` and `/audio-analysis` in Nov 2024 and now
 * requires a paid Premium subscription for API access at all. Rather than
 * depend on a dead endpoint, muscify measures the signal it is already playing.
 *
 * What is measured, per analysis tick:
 *
 *   energy     RMS loudness of the time-domain buffer.
 *   brightness Spectral centroid, normalised to 0..1.
 *   bpm        Tempo from autocorrelating an onset-strength envelope over a
 *              60..200 BPM range.
 *   beat       True on detected onsets, for beat-synced visuals and lyrics.
 *
 * Scope: this works only for sources the page plays through a real `<audio>`
 * element it owns — i.e. the radio directories. YouTube, Deezer and SoundCloud
 * play inside third-party iframes, and a cross-origin iframe's audio cannot be
 * routed into a Web Audio graph. For those, tracks fall back to tag-derived
 * moods rather than measured values. See `corsAllowsTapping`.
 */

import { TempoEstimator } from "./tempo.ts";
import { createNormalizer, dbToGain } from "./normalize.ts";

/** Rolling measurements for whatever is currently playing. */
export interface AudioFeatures {
  /** RMS loudness, normalised to 0..1 over the observed range. */
  energy: number;
  /** Spectral centroid, 0 (dark) .. 1 (bright). */
  brightness: number;
  /** Estimated tempo in BPM, or null while still converging. */
  bpm: number | null;
  /** 0..1 — how much the autocorrelation peak stood out. */
  tempoConfidence: number;
  /** True on the frame an onset was detected. */
  beat: boolean;
  /** Epoch ms of the measurement. */
  measuredAt: number;
}

export type FeatureListener = (features: AudioFeatures) => void;

/** Analysis window. Long enough to resolve tempo, short enough to feel live. */
const ENVELOPE_WINDOW_MS = 12_000;
/** Analysis ticks per second. ~30Hz resolves onsets without wasting frames. */
const TICK_MS = 33;

/** Beats closer together than this are a stutter, not a new onset. */
const ONSET_REFRACTORY_MS = 120;

/**
 * Web Audio taints — and therefore silences — a media element whose stream
 * lacks CORS headers, because the source node reads the bytes. Attaching
 * blindly would kill playback, so callers must prove CORS first.
 */
export async function corsAllowsTapping(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    const allow = res.headers.get("access-control-allow-origin");
    // `*` is fine; otherwise the header must echo an http(s) origin.
    return allow === "*" || /^https?:\/\//.test(allow ?? "");
  } catch {
    return false;
  }
}

/** Biquad filter description, used by the equalizer. */
export interface EqBand {
  type: BiquadFilterType;
  frequency: number;
  gain: number;
}

const DEFAULT_EQ: EqBand[] = Array.from({ length: 10 }, (_, i) => ({
  type: "peaking" as BiquadFilterType,
  // Logarithmic from ~30Hz to ~14kHz, which is how EQ bands are spaced.
  frequency: Math.round(30 * Math.pow(14000 / 30, i / 9)),
  gain: 0,
}));

/**
 * A MediaElementSource can only be created once per element; a second call
 * throws InvalidStateError. Engines are re-created across track changes, so the
 * mapping is cached for the lifetime of the element.
 */
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

export class AudioAnalyser {
  private ctx: AudioContext | null = null;
  private input: MediaElementAudioSourceNode | null = null;
  private eq: BiquadFilterNode[] = [];
  /**
   * Loudness trim, between the EQ and the analysis tap.
   *
   * Placed after the EQ deliberately: the correction is computed from the
   * signal the listener actually hears, so equalising first and measuring after
   * is the only order that can produce the right number.
   */
  private normaliseGain: GainNode | null = null;
  private normaliser = createNormalizer();
  private normalising = false;
  private analyser: AnalyserNode | null = null;
  private element: HTMLAudioElement | null = null;

  private raf = 0;
  private listeners = new Set<FeatureListener>();
  private lastTick = 0;

  /** Tempo tracker fed one mean-centred flux value per tick. */
  private tempo = new TempoEstimator(ENVELOPE_WINDOW_MS);

  /** Previous magnitude spectrum, for spectral-flux differencing. */
  private prevSpectrum: Float32Array | null = null;
  /** Adaptive onset threshold: running mean flux × this factor. */
  private fluxMean = 0;
  private lastOnsetAt = 0;

  /**
   * Band gains outlive the graph.
   *
   * `attach` rebuilds the biquad chain from scratch every time the media
   * element changes, which is every station change. Reading the user's
   * settings back off live nodes would silently flatten the equalizer to 0dB
   * the moment a new track loaded, so the gains are held here instead and
   * reapplied to each new node.
   */
  private gains: number[] = Array.from({ length: DEFAULT_EQ.length }, () => 0);

  /**
   * Normalising references. Loudness is measured relative to what this source
   * has been doing, so a quiet station and a loud one both use the full range.
   */
  private peakEnergy = 0.05;
  private peakCentroid = 0.35;

  /** Reused across ticks to keep the 30Hz loop allocation-free. */
  private timeBuf: Float32Array<ArrayBuffer> | null = null;
  private freqBuf: Float32Array<ArrayBuffer> | null = null;

  /**
   * Routes an element into the graph. Returns false if the element could not be
   * attached, in which case playback is untouched and analysis stays off.
   */
  attach(el: HTMLAudioElement): boolean {
    if (this.element === el) return true;
    this.detach();

    try {
      this.ctx ??= new AudioContext();
      // Autoplay policy starts contexts suspended; the play gesture resumes it.
      if (this.ctx.state === "suspended") void this.ctx.resume();

      this.input = sources.get(el) ?? null;
      if (!this.input) {
        this.input = this.ctx.createMediaElementSource(el);
        sources.set(el, this.input);
      }

      this.eq = DEFAULT_EQ.map((band, i) => {
        const node = this.ctx!.createBiquadFilter();
        node.type = band.type;
        node.frequency.value = band.frequency;
        node.gain.value = this.clampGain(this.gains[i] ?? 0);
        return node;
      });

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      // A little smoothing keeps the loudness meter from flickering per frame.
      this.analyser.smoothingTimeConstant = 0.65;

      // input → EQ chain → loudness trim → analyser → speakers.
      this.normaliseGain = this.ctx.createGain();
      this.normaliseGain.gain.value = 1;

      let node: AudioNode = this.input;
      for (const band of this.eq) {
        node.connect(band);
        node = band;
      }
      node.connect(this.normaliseGain);
      node = this.normaliseGain;
      node.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      this.element = el;
      this.prevSpectrum = null;
      this.reset();
      this.loop();
      return true;
    } catch {
      // Leaving a partially-built graph behind would risk silencing playback.
      this.hardDetach();
      return false;
    }
  }

  detach(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.element = null;
    // Disconnect rather than destroy: the source node cannot be recreated, so
    // the element keeps its association for a future attach.
    this.input?.disconnect();
    for (const band of this.eq) band.disconnect();
    this.normaliseGain?.disconnect();
    this.analyser?.disconnect();
    this.input = null;
    this.eq = [];
    this.normaliseGain = null;
    this.analyser = null;
    this.prevSpectrum = null;
    this.reset();
  }

  private hardDetach(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.input?.disconnect();
    this.eq = [];
    this.normaliseGain = null;
    this.analyser = null;
    this.input = null;
    this.element = null;
    this.reset();
  }

  private reset(): void {
    this.tempo.reset();
    this.fluxMean = 0;
    this.lastOnsetAt = 0;
  }

  /**
   * Turns loudness normalisation on or off.
   *
   * Off means a gain of exactly 1, not "stop updating": the reference keeps
   * learning either way, so switching it on mid-listen does not have to wait
   * for a fresh measurement before doing anything. That is the difference
   * between a toggle and a switch someone has to think about.
   */
  setNormalisation(enabled: boolean): void {
    this.normalising = enabled;
    if (!enabled) {
      this.normaliser.reset();
      if (this.normaliseGain) this.normaliseGain.gain.value = 1;
    }
  }

  /** Whether loudness normalisation is currently engaged. */
  get isNormalising(): boolean {
    return this.normalising;
  }

  /**
   * Feeds one RMS measurement to the normaliser and applies the correction.
   *
   * `setTargetAtTime` rather than a direct assignment: a per-tick step change
   * on a gain node is audible as a click, and this one runs at 30Hz.
   */
  private applyLoudnessTrim(energy: number): void {
    if (!this.normalising || !this.normaliseGain) return;
    if (!Number.isFinite(energy) || energy <= 0) return;

    const db = this.normaliser.observe(energy);
    const target = dbToGain(db);
    if (!Number.isFinite(target)) return;

    const now = this.ctx?.currentTime ?? 0;
    this.normaliseGain.gain.setTargetAtTime(target, now, 0.05);
  }

  /** Clamps a gain to the range the band nodes accept. */
  private clampGain(db: number): number {
    return Number.isFinite(db) ? Math.max(-12, Math.min(12, db)) : 0;
  }

  /**
   * Sets one band's gain in dB. Index is 0..9, matching the default layout.
   *
   * Writes through to the remembered gains as well as the live node, so a
   * station change does not flatten what the listener chose.
   */
  setBandGain(index: number, gainDb: number): void {
    if (index < 0 || index >= DEFAULT_EQ.length) return;
    const gain = this.clampGain(gainDb);
    this.gains[index] = gain;
    const band = this.eq[index];
    if (band) band.gain.value = gain;
  }

  /**
   * The current band gains in dB.
   *
   * Read by the equalizer panel so it opens showing what is actually applied
   * rather than its own initial state.
   */
  get bandGains(): number[] {
    return [...this.gains];
  }

  /** True when every band is flat, which the panel uses for its indicator. */
  get isFlat(): boolean {
    return this.gains.every((g) => g === 0);
  }

  /** Flattens every band. */
  resetEq(): void {
    this.eq.forEach((_, i) => this.setBandGain(i, 0));
  }

  /** True when an element is currently being measured. */
  get isAnalysing(): boolean {
    return this.analyser !== null;
  }

  subscribe(listener: FeatureListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (now - this.lastTick < TICK_MS) return;
    this.lastTick = now;

    const ctx = this.ctx;
    const analyser = this.analyser;
    if (!ctx || !analyser || ctx.state !== "running") return;

    this.timeBuf ??= new Float32Array(analyser.fftSize);
    this.freqBuf ??= new Float32Array(analyser.frequencyBinCount);

    analyser.getFloatTimeDomainData(this.timeBuf);
    analyser.getFloatFrequencyData(this.freqBuf);

    const energy = rms(this.timeBuf);
    const brightness = centroid(this.freqBuf, ctx.sampleRate, analyser.fftSize);
    const flux = this.pushFlux(this.freqBuf, now);

    // Loudness trim runs off the *raw* RMS, before the adaptive normalisation
    // below rescales energy for reporting. Normalising the measurement and then
    // correcting the signal from it would be circular: the trim would chase its
    // own effect.
    this.applyLoudnessTrim(energy);

    // Normalise against the running peak so energy means "loud relative to what
    // this source has been doing", not an absolute dB figure.
    this.peakEnergy = Math.max(this.peakEnergy * 0.999, energy, 0.05);
    this.peakCentroid = Math.max(this.peakCentroid * 0.999, brightness, 0.35);

    const { bpm, confidence } = this.tempo.estimate();

    const features: AudioFeatures = {
      energy: clamp01(energy / this.peakEnergy),
      brightness: clamp01(brightness / this.peakCentroid),
      bpm,
      tempoConfidence: confidence,
      beat: flux.onBeat,
      measuredAt: Date.now(),
    };

    for (const listener of this.listeners) listener(features);
  };

  /**
   * Spectral flux with an adaptive threshold.
   *
   * Only the positive half of the difference is summed: energy *appearing* is
   * what an onset is, and including negative flux would make a sustained loud
   * passage read as a continuous stream of onsets.
   *
   * Returns the flux value and whether this tick crossed the onset threshold.
   */
  private pushFlux(spectrum: Float32Array, now: number): { flux: number; onBeat: boolean } {
    const prev = this.prevSpectrum;
    this.prevSpectrum = spectrum.slice();
    if (!prev) return { flux: 0, onBeat: false };

    let flux = 0;
    for (let i = 0; i < spectrum.length; i++) {
      const d = spectrum[i] - prev[i];
      if (d > 0) flux += d;
    }
    flux /= spectrum.length;

    // Track the mean so the threshold follows the material's density instead of
    // being a fixed number that suits only one genre.
    this.fluxMean = this.fluxMean * 0.995 + flux * 0.005;

    // Envelope stores flux relative to the running mean: autocorrelation
    // needs a mean-centred signal or DC offset dominates the result.
    this.tempo.push(Math.max(0, flux - this.fluxMean));

    const threshold = this.fluxMean * 0.6 + 0.0016;
    const onBeat = flux > threshold && now - this.lastOnsetAt >= ONSET_REFRACTORY_MS;
    if (onBeat) this.lastOnsetAt = now;

    return { flux, onBeat };
  }

}

function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/** Frequency below which the spectrum's energy mass centres, mapped to 0..1. */
function centroid(freq: Float32Array, sampleRate: number, fftSize: number): number {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < freq.length; i++) {
    // dB values are negative; exponentiate back to linear magnitude.
    const mag = 10 ** (freq[i] / 20);
    weighted += mag * i;
    total += mag;
  }
  if (total <= 0) return 0;
  const hz = ((weighted / total) * sampleRate) / fftSize;
  // Map 20Hz..16kHz onto 0..1, which is roughly where perceived brightness lives.
  return clamp01(Math.log2(Math.max(hz, 20) / 20) / Math.log2(16_000 / 20));
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Process-wide singleton; one AudioContext for the whole app. */
let shared: AudioAnalyser | null = null;
export function getAnalyser(): AudioAnalyser {
  shared ??= new AudioAnalyser();
  return shared;
}