import { test } from "node:test";
import assert from "node:assert/strict";

import { migrate, pruneCatalog } from "./local.ts";
import { SNAPSHOT_VERSION, emptySnapshot } from "./types.ts";

/**
 * Migration and normalisation.
 *
 * The one that matters most here is the least obvious. `normalise` rebuilds a
 * snapshot from named fields, so any field added outside `LibrarySnapshot`
 * disappears on the way through. That is exactly what happened to the sync
 * conflict clock: it was spread in as a loose extra, stripped by `normalise`,
 * and every pulled copy then compared as older than local — so sync silently
 * never adopted anything and looked like a feature that merely did not work.
 */

test("normalise preserves the sync conflict clock", () => {
  const stamped = { ...emptySnapshot(), updatedAt: 1_700_000_000_000 };
  assert.equal(migrate(stamped).updatedAt, 1_700_000_000_000);
});

test("a missing or nonsensical clock becomes 0 rather than NaN", () => {
  assert.equal(migrate(emptySnapshot()).updatedAt, 0);

  const broken = { ...emptySnapshot(), updatedAt: Number.NaN } as never;
  assert.equal(migrate(broken).updatedAt, 0, "NaN would make every comparison false");

  const negative = { ...emptySnapshot(), updatedAt: -5 };
  assert.equal(migrate(negative).updatedAt, -5, "a real timestamp is passed through as-is");
});

test("the clock survives a version migration", () => {
  // v1 payloads have no clock; migrating must not invent one that would then
  // beat a genuinely newer server copy.
  const v1 = { ...emptySnapshot(), version: 1, updatedAt: 0 };
  assert.equal(migrate(v1).version, SNAPSHOT_VERSION);
  assert.equal(migrate(v1).updatedAt, 0);
});

test("a payload from a newer build is refused, not partially read", () => {
  const future = { ...emptySnapshot(), version: SNAPSHOT_VERSION + 1 };
  const result = migrate(future);
  assert.deepEqual(result, emptySnapshot(), "and the clock must not survive the refusal");
});

test("migrate fills in missing collections rather than leaving them undefined", () => {
  const sparse = { version: SNAPSHOT_VERSION } as never;
  const result = migrate(sparse);

  assert.deepEqual(result.catalog, {});
  assert.deepEqual(result.playlists, []);
  assert.deepEqual(result.liked, []);
  assert.deepEqual(result.recentlyPlayed, []);
  assert.deepEqual(result.followedArtists, []);
  assert.deepEqual(result.followedPlaylists, []);
  assert.deepEqual(result.searchHistory, []);
  assert.equal(Array.isArray(result.taste.hidden), true);
  assert.equal(Array.isArray(result.taste.snoozed), true);
  assert.equal(Array.isArray(result.taste.plays), true);
});

test("migrate returns a clean snapshot for junk rather than throwing", () => {
  for (const junk of [null, undefined, 0, "nope", true, []]) {
    const result = migrate(junk as never);
    assert.equal(result.version, SNAPSHOT_VERSION, `junk: ${JSON.stringify(junk)}`);
  }
});

test("pruneCatalog keeps only tracks something still references", () => {
  const snapshot = {
    ...emptySnapshot(),
    catalog: {
      "youtube:keep": { track: { source: "youtube", id: "keep", title: "Keep" }, addedAt: 1 },
      "youtube:orphan": { track: { source: "youtube", id: "orphan", title: "Orphan" }, addedAt: 1 },
    },
    liked: [{ key: "youtube:keep", addedAt: 1 }],
  } as never;

  const pruned = pruneCatalog(snapshot);
  assert.ok(pruned.catalog["youtube:keep"], "a liked track must survive");
  assert.equal(pruned.catalog["youtube:orphan"], undefined, "an unreferenced track must go");
});

test("pruneCatalog keeps tracks referenced only by taste entries", () => {
  const snapshot = {
    ...emptySnapshot(),
    catalog: {
      "youtube:hidden": { track: { source: "youtube", id: "hidden", title: "H" }, addedAt: 1 },
      "youtube:snoozed": { track: { source: "youtube", id: "snoozed", title: "S" }, addedAt: 1 },
      "youtube:gone": { track: { source: "youtube", id: "gone", title: "G" }, addedAt: 1 },
    },
    taste: {
      hidden: [{ key: "youtube:hidden", at: 1 }],
      snoozed: [{ key: "youtube:snoozed", until: Date.now() + 60_000, at: 1 }],
      plays: [],
    },
  } as never;

  const pruned = pruneCatalog(snapshot);
  // Pruning these would leave a hide or snooze pointing at a track that can no
  // longer be resolved, which silently un-hides it.
  assert.ok(pruned.catalog["youtube:hidden"]);
  assert.ok(pruned.catalog["youtube:snoozed"]);
  assert.equal(pruned.catalog["youtube:gone"], undefined);
});

test("pruneCatalog keeps a playlist cover key", () => {
  const snapshot = {
    ...emptySnapshot(),
    catalog: {
      "youtube:cover": { track: { source: "youtube", id: "cover", title: "C" }, addedAt: 1 },
      "youtube:extra": { track: { source: "youtube", id: "extra", title: "E" }, addedAt: 1 },
    },
    playlists: [
      { id: "p", name: "P", description: "", items: [], createdAt: 1, updatedAt: 1, coverKey: "youtube:cover" },
    ],
  } as never;

  const pruned = pruneCatalog(snapshot);
  assert.ok(pruned.catalog["youtube:cover"], "the artwork must not be pruned out from under the tile");
  assert.equal(pruned.catalog["youtube:extra"], undefined);
});