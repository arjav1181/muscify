import { test } from "node:test";
import assert from "node:assert/strict";
import { planSwitch, type SourceId } from "./switch-plan.ts";

const ALL: SourceId[] = ["youtube", "deezer", "soundcloud", "radio"];

const base = {
  all: ALL,
  isPlaying: true,
};

/** The regression: same source, different track. */
test("switching between two YouTube tracks loads the new one", () => {
  const plan = planSwitch({
    ...base,
    target: "youtube",
    active: "youtube",
    targetKey: "youtube:bbb",
    activeKey: "youtube:aaa",
  });

  assert.equal(plan.load, true, "the incoming track must be loaded");
  assert.equal(plan.play, true);
  assert.equal(plan.sameSource, true);
});

test("switching between two radio stations loads the new one", () => {
  const plan = planSwitch({
    ...base,
    target: "radio",
    active: "radio",
    targetKey: "radio:two",
    activeKey: "radio:one",
  });
  assert.equal(plan.load, true);
  assert.deepEqual(plan.stopSources, [], "no need to stop siblings within one source");
});

test("switching between two Deezer tracks loads the new one", () => {
  const plan = planSwitch({
    ...base,
    target: "deezer",
    active: "deezer",
    targetKey: "deezer:2",
    activeKey: "deezer:1",
  });
  assert.equal(plan.load, true);
});

test("a cross-source switch stops the other engines", () => {
  const plan = planSwitch({
    ...base,
    target: "youtube",
    active: "radio",
    targetKey: "youtube:1",
    activeKey: "radio:1",
  });
  assert.equal(plan.load, true);
  assert.deepEqual(plan.stopSources.sort(), ["deezer", "radio", "soundcloud"].sort());
  assert.equal(plan.claim, "youtube");
});

test("the first track loads and claims its source", () => {
  const plan = planSwitch({
    ...base,
    target: "radio",
    active: null,
    targetKey: "radio:1",
    activeKey: null,
  });
  assert.equal(plan.load, true);
  assert.equal(plan.claim, "radio");
  assert.deepEqual(plan.stopSources.sort(), ["deezer", "soundcloud", "youtube"].sort());
});

test("re-rendering with the same track is not a switch", () => {
  const plan = planSwitch({
    ...base,
    target: "youtube",
    active: "youtube",
    targetKey: "youtube:same",
    activeKey: "youtube:same",
  });
  assert.equal(plan.load, false, "must not reload the same track");
  assert.equal(plan.play, false);
  assert.deepEqual(plan.stopSources, []);
});

test("clearing the queue stops everything and goes idle", () => {
  const plan = planSwitch({
    ...base,
    target: null,
    active: "youtube",
    targetKey: null,
    activeKey: "youtube:1",
  });
  assert.equal(plan.idle, true);
  assert.equal(plan.load, false);
  assert.equal(plan.claim, null);
  assert.deepEqual(plan.stopSources.sort(), ["deezer", "radio", "soundcloud"].sort());
});

test("a paused transport loads but does not start playing", () => {
  const plan = planSwitch({
    ...base,
    target: "youtube",
    active: "youtube",
    targetKey: "youtube:2",
    activeKey: "youtube:1",
    isPlaying: false,
  });
  assert.equal(plan.load, true, "the track still has to be loaded");
  assert.equal(plan.play, false, "but it must not begin playing on its own");
});

test("the same track key in a different source is still a switch", () => {
  // Source is part of the key, but be explicit that it is compared anyway.
  const plan = planSwitch({
    ...base,
    target: "youtube",
    active: "deezer",
    targetKey: "x",
    activeKey: "x",
  });
  assert.equal(plan.load, true, "a source change must load regardless of key shape");
});

test("every cross-source transition produces exactly one owner", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      if (from === to) continue;
      const plan = planSwitch({
        ...base,
        target: to,
        active: from,
        targetKey: `${to}:1`,
        activeKey: `${from}:1`,
      });
      assert.equal(plan.claim, to);
      assert.ok(!plan.stopSources.includes(to), `${to} must not stop itself`);
      assert.ok(plan.stopSources.includes(from), `${from} must be stopped`);
      assert.equal(plan.load, true);
    }
  }
});