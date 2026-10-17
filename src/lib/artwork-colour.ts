/**
 * Dominant colour extraction from album artwork.
 *
 * The design guidelines recommend deriving a Now Playing background from the
 * artwork's own colour, falling back to `#191414` when that isn't possible.
 *
 * Implementation notes:
 *  - A 1x1 downscale is enough. Sampling at full size would decode a several
 *    hundred KB image just to pick one colour.
 *  - Colours are bucketed before voting. Anti-aliased gradients otherwise
 *    produce thousands of near-identical buckets and the "dominant" colour
 *    ends up being whichever JPEG artefact happened to be most common.
 *  - Saturation and mid-brightness are preferred, so a black or white cover
 *    does not produce an unusable background.
 *  - Cross-origin images taint the canvas and `getImageData` throws. Covers
 *    come from several providers, so this is a routine path, not an edge case.
 */

export const ARTWORK_FALLBACK_BG = "#191414";

/** 4 bits per channel: 4096 buckets, fine enough without fragmenting. */
const BUCKET_BITS = 4;
const BUCKET_SHIFT = 8 - BUCKET_BITS;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function toHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}

/**
 * Relative luminance, for deciding whether a colour is usable as a backdrop.
 */
export function luminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Rough HSV saturation, 0..1, from RGB. */
function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Picks a backdrop colour from raw image pixels.
 *
 * Exported separately from the DOM so it can be tested without a browser.
 */
export function dominantColour(data: Uint8ClampedArray): string {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!;
    // Transparent pixels carry no usable colour and would skew the vote.
    if (alpha < 125) continue;

    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;

    // Ignore near-black and near-white: they are the most common colours in
    // album art precisely because of borders, shadows and blown highlights.
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (l < 22 || l > 238) continue;

    const key = ((r >> BUCKET_SHIFT) << (BUCKET_BITS * 2)) | ((g >> BUCKET_SHIFT) << BUCKET_BITS) | (b >> BUCKET_SHIFT);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  if (buckets.size === 0) return ARTWORK_FALLBACK_BG;

  let best: { count: number; r: number; g: number; b: number } | null = null;
  let bestScore = -1;
  for (const bucket of buckets.values()) {
    const avg = { r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count };
    // Count leads; saturation only breaks near-ties. A decisively dominant
    // colour wins even if it is flat, because a backdrop that contradicts the
    // artwork's actual dominant colour is more surprising than a dull one.
    const score = bucket.count * (1 + saturation(avg) * 2.2) * (luminance(avg) > 0.02 ? 1 : 0.2);
    if (score > bestScore) {
      bestScore = score;
      best = bucket;
    }
  }

  if (!best) return ARTWORK_FALLBACK_BG;
  return toHex({ r: best.r / best.count, g: best.g / best.count, b: best.b / best.count });
}

/** Result of a colour probe, including whether the fallback was used. */
export interface ArtworkColour {
  hex: string;
  /** True when the image could not be read and the fallback is in use. */
  fellBack: boolean;
}

export const FALLBACK_COLOUR: ArtworkColour = { hex: ARTWORK_FALLBACK_BG, fellBack: true };

/**
 * Reads a cover image and extracts a backdrop colour.
 *
 * Always resolves — a blocked or broken image yields the fallback rather than
 * rejecting, because a missing backdrop must never break playback.
 */
export function extractArtworkColour(url: string): Promise<ArtworkColour> {
  if (typeof window === "undefined" || !url) return Promise.resolve(FALLBACK_COLOUR);

  return new Promise((resolve) => {
    const image = new Image();
    // Required, or a cross-origin cover taints the canvas and getImageData throws.
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    const done = (value: ArtworkColour) => resolve(value);
    const fail = () => done(FALLBACK_COLOUR);

    image.onload = () => {
      try {
        // 1x1 downscale: enough to sample the whole image, cheap enough to be free.
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return fail();
        ctx.drawImage(image, 0, 0, 1, 1);
        const { data } = ctx.getImageData(0, 0, 1, 1);
        done({ hex: dominantColour(data), fellBack: false });
      } catch {
        // Tainted canvas — the provider did not send CORS headers.
        fail();
      }
    };
    image.onerror = fail;

    // Do not let a slow cover hold the backdrop hostage.
    const timer = setTimeout(fail, 3000);
    image.src = url;
    return () => clearTimeout(timer);
  });
}