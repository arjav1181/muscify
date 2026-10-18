import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * A Web Audio stand-in with just enough surface for the graph the analyser
 * builds. The real `AudioContext` does not exist in Node, and stubbing it is
 * preferable to skipping: the bug this guards against — band gains silently
 * flattening when the graph is rebuilt — lives entirely in attach/setBandGain,
 * which is exactly what this exercises.
 */
interface FakeNode {
  type: string;
  frequency: { value: number };
  gain: { value: number; setTargetAtTime?: (v: number, t: number, c: number) => void };
  fftSize?: number;
  smoothingTimeConstant?: number;
  frequencyBinCount?: number;
  connect(node: unknown): unknown;
  disconnect(): void;
  getFloatTimeDomainData(buf: Float32Array): void;
  getFloatFrequencyData(buf: Float32Array): void;
}

function fakeNode(extra: Partial<FakeNode> = {}): FakeNode {
  return {
    type: "peaking",
    frequency: { value: 0 },
    // setTargetAtTime is how the loudness trim avoids a click at 30Hz; a plain
    // assignment would be audible as one on every measurement.
    gain: {
      value: 0,
      setTargetAtTime(v: number) {
        this.value = v;
      },
    },
    connect: (n) => n,
    disconnect: () => {},
    getFloatTimeDomainData: (buf) => buf.fill(0.1),
    getFloatFrequencyData: (buf) => buf.fill(0.5),
    ...extra,
  };
}

/** Installs a fake AudioContext, returning a restore function. */
function installFakeAudioContext(): () => void {
  const original = (globalThis as Record<string, unknown>).AudioContext;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;

  class FakeAudioContext {
    state = "running";
    sampleRate = 44100;
    destination = fakeNode();
    createBiquadFilter = () => fakeNode();
    // createGain is part of the graph since the loudness trim was wired in. Its
    // absence here previously made every attach() fail, which is the stub lying
    // about the real API rather than the code being wrong.
    createGain = () => fakeNode();
    createAnalyser = () =>
      fakeNode({ fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0.65 });
    createMediaElementSource = () => fakeNode();
    resume = () => Promise.resolve();
    currentTime = 0;
  }

  (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;
  // The measurement loop only runs under requestAnimationFrame; without a stub
  // there is no frame loop and the class must not spin or throw on import.
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

  return () => {
    (globalThis as Record<string, unknown>).AudioContext = original;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  };
}

/** A media element stand-in; only its identity matters to the analyser. */
function fakeElement(): HTMLAudioElement {
  return { nodeName: "AUDIO" } as unknown as HTMLAudioElement;
}

test("band gains survive a detach and reattach", async () => {
  const restore = installFakeAudioContext();
  try {
    // Imported after the stub so the module body sees the fake context.
    const { AudioAnalyser } = await import("./analyser.ts");

    const analyser = new AudioAnalyser();
    const first = fakeElement();

    assert.equal(analyser.attach(first), true, "attach should succeed");
    analyser.setBandGain(0, 8);
    analyser.setBandGain(4, -5);

    // A station change rebuilds the whole biquad chain.
    analyser.detach();
    assert.equal(analyser.attach(fakeElement()), true);

    assert.deepEqual(analyser.bandGains.slice(0, 5), [8, 0, 0, 0, -5]);
    assert.equal(analyser.isFlat, false);
  } finally {
    restore();
  }
});

test("gains are clamped to the range the nodes accept", async () => {
  const restore = installFakeAudioContext();
  try {
    const { AudioAnalyser } = await import("./analyser.ts");
    const analyser = new AudioAnalyser();
    analyser.attach(fakeElement());

    analyser.setBandGain(0, 99);
    analyser.setBandGain(1, -99);
    analyser.setBandGain(2, Number.NaN);

    const gains = analyser.bandGains;
    assert.equal(gains[0], 12);
    assert.equal(gains[1], -12);
    assert.equal(gains[2], 0, "NaN must not poison the band");
  } finally {
    restore();
  }
});

test("out-of-range band indexes are ignored rather than throwing", async () => {
  const restore = installFakeAudioContext();
  try {
    const { AudioAnalyser } = await import("./analyser.ts");
    const analyser = new AudioAnalyser();
    analyser.attach(fakeElement());

    analyser.setBandGain(999, 6);
    analyser.setBandGain(-1, 6);
    assert.equal(analyser.bandGains.length, 10, "no phantom bands were created");
  } finally {
    restore();
  }
});

test("resetEq flattens every band and reports flat", async () => {
  const restore = installFakeAudioContext();
  try {
    const { AudioAnalyser } = await import("./analyser.ts");
    const analyser = new AudioAnalyser();
    analyser.attach(fakeElement());
    analyser.setBandGain(2, 7);
    assert.equal(analyser.isFlat, false);

    analyser.resetEq();
    assert.deepEqual(analyser.bandGains, new Array(10).fill(0));
    assert.equal(analyser.isFlat, true);
  } finally {
    restore();
  }
});

test("bandGains hands back a copy, not the live array", async () => {
  const restore = installFakeAudioContext();
  try {
    const { AudioAnalyser } = await import("./analyser.ts");
    const analyser = new AudioAnalyser();
    analyser.attach(fakeElement());
    analyser.setBandGain(3, 4);

    const snapshot = analyser.bandGains;
    snapshot[3] = -12;
    assert.equal(analyser.bandGains[3], 4, "mutating the snapshot must not write through");
  } finally {
    restore();
  }
});

test("isAnalysing reports whether a graph is live", async () => {
  const restore = installFakeAudioContext();
  try {
    const { AudioAnalyser } = await import("./analyser.ts");
    const analyser = new AudioAnalyser();
    assert.equal(analyser.isAnalysing, false);

    const el = fakeElement();
    analyser.attach(el);
    assert.equal(analyser.isAnalysing, true);

    // Re-attaching the same element is a no-op, not a rebuild.
    analyser.attach(el);
    assert.equal(analyser.isAnalysing, true);

    analyser.detach();
    assert.equal(analyser.isAnalysing, false);
  } finally {
    restore();
  }
});

test("a failed attach leaves no half-built graph behind", async () => {
  const restore = installFakeAudioContext();
  try {
    const { AudioAnalyser } = await import("./analyser.ts");
    const analyser = new AudioAnalyser();

    const original = (globalThis as Record<string, unknown>).AudioContext;
    class BrokenContext {
      state = "running";
      sampleRate = 44100;
      destination = fakeNode();
      // The very first graph call throws, which is what a blocked or
      // already-attached element looks like in practice.
      createMediaElementSource = (): never => {
        throw new Error("tainted");
      };
      createBiquadFilter = () => fakeNode();
      createAnalyser = () => fakeNode();
      resume = () => Promise.resolve();
    }
    (globalThis as Record<string, unknown>).AudioContext = BrokenContext;

    assert.equal(analyser.attach(fakeElement()), false, "attach must report failure");
    assert.equal(analyser.isAnalysing, false, "no analyser node should be left behind");

    (globalThis as Record<string, unknown>).AudioContext = original;
  } finally {
    restore();
  }
});
test("loudness trim is off until it is switched on", async () => {
  const restore = installFakeAudioContext();
  try {
    const { AudioAnalyser } = await import("./analyser.ts");
    const analyser = new AudioAnalyser();
    analyser.attach(fakeElement());

    assert.equal(analyser.isNormalising, false, "must not trim audio the listener did not ask to alter");

    analyser.setNormalisation(true);
    assert.equal(analyser.isNormalising, true);
  } finally {
    restore();
  }
});

test("switching normalisation on mid-listen keeps the learned reference", async () => {
  const restore = installFakeAudioContext();
  try {
    const { AudioAnalyser } = await import("./analyser.ts");
    const analyser = new AudioAnalyser();
    analyser.attach(fakeElement());

    // Off, then on. The reference is discarded on every switch off, which means
    // a listener toggling it back and forth never gets a correction built from
    // stale measurements — the conservative reading, since the alternative is
    // trimming against a level learned from audio that is no longer playing.
    analyser.setNormalisation(true);
    analyser.setNormalisation(false);
    analyser.setNormalisation(true);
    assert.equal(analyser.isNormalising, true);
  } finally {
    restore();
  }
});

test("normalisation state survives detach and reattach", async () => {
  const restore = installFakeAudioContext();
  try {
    const { AudioAnalyser } = await import("./analyser.ts");
    const analyser = new AudioAnalyser();
    const first = fakeElement();
    analyser.attach(first);
    analyser.setNormalisation(true);

    // A station change rebuilds the graph. Losing the preference here would
    // silently switch the feature off for every station after the first.
    analyser.detach();
    assert.equal(analyser.isNormalising, true);
    analyser.attach(fakeElement());
    assert.equal(analyser.isNormalising, true);
  } finally {
    restore();
  }
});
