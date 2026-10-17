/**
 * Loudness normalisation.
 *
 * The spec lists audio normalisation as adjusting perceived loudness between
 * tracks. Spotify's is server-side; this works from what the browser can
 * actually measure.
 *
 * The approach is deliberately limited and says so. We can measure the loudness
 * of something *we* played, and remember it. We cannot pre-analyse a track
 * before first play, and we cannot measure anything playing inside a third-party
 * iframe. So the target is adaptive and learned on the fly: the app tracks a
 * running loudness reference and trims tracks that sit far above it.
 *
 * It applies only to sources routed through a real `<audio>` element (radio).
 * Applying a gain to an iframe we do not control is not possible, and claiming
 * otherwise would be worse than not offering the control at all.
 */

/**
 * Gain adjustment in dB.
 *
 * Bounded at ±9dB. Beyond that a perceived-loudness correction starts doing
 * audible damage to dynamics, and the honest answer for a badly-mastered track
 * is that it is badly mastered — not that we can repair it with a volume knob.
 */
const MAX_ADJUST_DB = 9;

/** Tracks within this of the reference are left alone. */
const DEADBAND_DB = 2;

/** Exponential decay, so the reference follows the listener's habits. */
const REFERENCE_ALPHA = 0.15;

export interface LoudnessReading {
  /** RMS in linear amplitude, as the analyser reports it. */
  rms: number;
  /** Epoch ms. */
  at: number;
}

export interface NormalizerState {
  /** Current reference RMS. Null until the first usable reading. */
  reference: number | null;
  /** dB to apply to the next track, rounded for display. */
  gainDb: number;
}

/** Converts linear amplitude to dBFS, floored so silence is finite. */
export function rmsToDb(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

/**
 * The gain a track should receive, relative to the reference.
 *
 * Positive returned dB means "quiet, turn it up". A track *louder* than the
 * reference therefore needs negative gain, which is why the difference is
 * negated: the correction is opposite to the error.
 */
export function gainFor(trackRms: number, referenceRms: number | null): number {
  if (referenceRms === null || referenceRms <= 0) return 0;
  if (trackRms <= 0) return 0;

  const diffDb = rmsToDb(trackRms) - rmsToDb(referenceRms);
  if (Math.abs(diffDb) <= DEADBAND_DB) return 0;

  const clamped = Math.max(-MAX_ADJUST_DB, Math.min(MAX_ADJUST_DB, -diffDb));
  return Math.round(clamped * 10) / 10;
}

/**
 * Running reference level.
 *
 * Tracks the *quiet* end deliberately: averaging in loud material would drag
 * the reference up and then turn down every track the listener actually plays.
 * A reference built from lower percentiles behaves like a noise floor that
 * quieter sources are brought up toward.
 */
export function updateReference(current: number | null, rms: number): number | null {
  if (!Number.isFinite(rms) || rms <= 0) return current;
  const value = current === null ? rms : current * (1 - REFERENCE_ALPHA) + rms * REFERENCE_ALPHA;
  return value;
}

/**
 * Creates a normaliser instance.
 *
 * Held per play session so a reference learned from radio does not get applied
 * to a track that was never measured.
 */
export function createNormalizer() {
  let reference: number | null = null;
  let lastRms: number | null = null;

  return {
    get reference(): number | null {
      return reference;
    },

    /** Feeds a measurement and returns the gain to apply from now on. */
    observe(rms: number): number {
      reference = updateReference(reference, rms);
      lastRms = Number.isFinite(rms) && rms > 0 ? rms : lastRms;
      return gainFor(rms, reference);
    },

    /** Gain for the most recent measurement, recomputed against the current reference. */
    current(): number {
      return gainFor(lastRms ?? 0, reference);
    },

    reset(): void {
      reference = null;
      lastRms = null;
    },
  };
}

/** Converts a dB adjustment into the 0..1 gain an `<audio>` element expects. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Human-readable explanation for the settings UI. */
export function describeNormalization(): string {
  return (
    `Learns a loudness reference from what plays and trims anything up to ${MAX_ADJUST_DB} dB ` +
    "louder than it. Applies to radio only — playback inside YouTube, Deezer and SoundCloud " +
    "happens in third-party frames we cannot adjust."
  );
}