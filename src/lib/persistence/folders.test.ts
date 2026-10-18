import { test } from "node:test";
import assert from "node:assert/strict";

import { migrate } from "./local.ts";
import { emptySnapshot, SNAPSHOT_VERSION, type LibrarySnapshot } from "./types.ts";

/**
 * Folders are the first field added to `LibrarySnapshot` since `updatedAt`, and
 * the failure mode is identical: `normalise()` rebuilds the snapshot from named
 * fields, so a field absent from it is silently dropped on every single load.
 *
 * These go through `migrate` rather than reaching for `normalise` directly,
 * because `migrate` is what a real reload calls and it is what a v2 payload on
 * disk actually meets. Asserting the type would not have caught the `updatedAt`
 * regression either -- the field was declared, and still vanished.
 */

/** The path a real reload takes. */
function reload(stored: unknown): LibrarySnapshot {
  return migrate(stored as LibrarySnapshot);
}

function withFolder(): LibrarySnapshot {
  const snap = emptySnapshot();
  snap.folders = [
    { id: "f1", name: "Road trip", createdAt: 1, updatedAt: 2 },
    { id: "f2", name: "Focus", createdAt: 3, updatedAt: 4 },
  ];
  snap.playlists = [
    {
      id: "p1",
      name: "Night drive",
      description: "",
      items: [],
      createdAt: 1,
      updatedAt: 1,
      folderId: "f1",
    },
  ];
  return snap;
}

test("folders survive a migrate round trip", () => {
  const out = reload(withFolder());
  assert.equal(out.folders.length, 2, "folders were dropped by normalise");
  assert.equal(out.folders[0]?.name, "Road trip");
});

test("a playlist keeps its folder assignment through migrate", () => {
  const out = reload(withFolder());
  assert.equal(out.playlists[0]?.folderId, "f1");
});

test("a snapshot written before folders existed loads with none, not undefined", () => {
  // What a v2 payload looks like: no `folders` key at all.
  const legacy = { ...emptySnapshot(), version: 2 } as unknown as LibrarySnapshot;
  delete (legacy as { folders?: unknown }).folders;

  const out = reload(legacy);
  assert.deepEqual(out.folders, []);
  assert.equal(out.version, SNAPSHOT_VERSION);
});

test("folders without a usable id are dropped rather than kept as junk", () => {
  const snap = emptySnapshot();
  snap.folders = [
    { id: "", name: "Nameless id", createdAt: 1, updatedAt: 1 },
    { id: "f1", name: "Real", createdAt: 1, updatedAt: 1 },
  ];
  const out = reload(snap);
  assert.equal(out.folders.length, 1);
  assert.equal(out.folders[0]?.id, "f1");
});

test("a corrupt folders value cannot break the load", () => {
  const snap = { ...emptySnapshot(), folders: "not an array" } as unknown as LibrarySnapshot;
  assert.deepEqual(reload(snap).folders, []);
});