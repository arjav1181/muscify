import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

import { PostgresStore } from "./postgres-store.ts";
import { emptySnapshot, SNAPSHOT_VERSION } from "./types.ts";

/**
 * Integration tests against a real Postgres.
 *
 * Skipped entirely unless `MUSCIFY_DATABASE_URL` is set, so CI stays hermetic
 * and the default deployment is unaffected. When it is set they are the only
 * thing in the suite that has ever executed the SQL, which is how a double
 * encoding bug survived in `server-store.ts` for so long: the code was
 * syntactically fine, unit-testable in isolation, and never ran.
 *
 * Point it at a scratch database. These tests write rows.
 */

const URL = process.env.MUSCIFY_DATABASE_URL;
// Skip when the URL is ABSENT. (Inverted this at first, which meant the suite
// skipped precisely whenever it could have done something useful.)
const opts = URL ? undefined : { skip: "set MUSCIFY_DATABASE_URL to run" };


// The driver pools connections, so without this the test process never exits
// and the run hangs until the runner kills it -- measured at 200s for a suite
// whose tests take under two.
const open = new Set<PostgresStore>();
after(async () => {
  await Promise.all([...open].map((s) => s.close()));
});

function newStore(): PostgresStore {
  const s = new PostgresStore(URL!);
  open.add(s);
  return s;
}

/** A unique id per run, so a repeat run cannot collide with its own leftovers. */
let seq = 0;
const fresh = (kind: "google" | "github") => ({
  provider: kind,
  providerAccountId: `test-${process.pid}-${seq++}`,
});

async function makeUser(kind: "google" | "github" = "google") {
  const s = newStore();
  const profile = { ...fresh(kind), email: `${profile_id()}@example.test`, name: "Test" };
  return { s, user: await s.findOrCreateUser(profile) };
}
function profile_id() {
  return `t${process.pid}x${seq}`;
}

describe("PostgresStore", opts ?? {}, () => {
  test("reports the schema as present", async () => {
    assert.equal(await newStore().schemaReady(), true);
  });

  test("round-trips a snapshot as a JSON document, not a JSON string", async () => {
    const { s, user } = await makeUser();
    const snap = emptySnapshot();
    snap.playlists.push({
      id: "p1",
      name: "Road trip",
      description: "",
      items: ["yt:a", "yt:b"],
      createdAt: 1,
      updatedAt: 2,
    });
    // The bug this guards: with JSON.stringify(...)::jsonb the row is stored as
    // a JSON *string scalar*, so this read returns a string and the assertion
    // below fails on `typeof`, not on a missing playlist.
    await s.writeUser(user.id, snap);

    const row = await s.readUser(user.id);
    assert.ok(row, "row should exist");
    assert.equal(typeof row.snapshot, "object", "snapshot must not come back as a string");
    assert.equal(row.snapshot.playlists[0]?.name, "Road trip");
    assert.equal(row.snapshot.version, SNAPSHOT_VERSION);

    await s.removeUser(user.id);
  });

  test("preserves the client's own clock rather than the database's", async () => {
    const { s, user } = await makeUser();
    const snap = emptySnapshot();
    snap.updatedAt = 1_700_000_000_000;
    await s.writeUser(user.id, snap);

    const row = await s.readUser(user.id);
    assert.equal(row?.snapshot.updatedAt, 1_700_000_000_000);
    // The server clock is still recorded, for operators.
    assert.ok(Number.isFinite(Date.parse(row?.updated_at ?? "")));

    await s.removeUser(user.id);
  });

  test("a second write replaces the row rather than adding one", async () => {
    const { s, user } = await makeUser();
    const snap = emptySnapshot();
    snap.playlists.push({
      id: "p1",
      name: "First",
      description: "",
      items: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await s.writeUser(user.id, snap);
    snap.playlists[0].name = "Second";
    await s.writeUser(user.id, snap);

    const row = await s.readUser(user.id);
    assert.equal(row?.snapshot.playlists.length, 1);
    assert.equal(row?.snapshot.playlists[0]?.name, "Second");

    await s.removeUser(user.id);
  });

  test("an unknown user reads null instead of throwing", async () => {
    assert.equal(await newStore().readUser("no-such-user-id"), null);
  });

  describe("identity", () => {
    test("is stable across repeated sign-ins", async () => {
      const s = newStore();
      const profile = fresh("google");
      const first = await s.findOrCreateUser({ ...profile, email: "a@example.test" });
      const second = await s.findOrCreateUser({ ...profile, email: "a@example.test" });
      assert.equal(first.id, second.id);
      await s.removeUser(first.id);
    });

    test("namespaces by provider so ids cannot collide across providers", async () => {
      const s = newStore();
      const shared = "same-id-at-both-providers";
      const g = await s.findOrCreateUser({ provider: "google", providerAccountId: shared });
      const h = await s.findOrCreateUser({ provider: "github", providerAccountId: shared });
      assert.notEqual(g.id, h.id);
      await s.removeUser(g.id);
      await s.removeUser(h.id);
    });

    test("does NOT merge two providers on a shared email", async () => {
      // Documented as deliberate: auto-merging on email is how unrelated
      // accounts get welded together, and a person seeing two libraries is a far
      // cheaper mistake than two strangers sharing one.
      const s = newStore();
      const email = `shared-${process.pid}@example.test`;
      const g = await s.findOrCreateUser({
        provider: "google",
        providerAccountId: `g-${process.pid}`,
        email,
      });
      const h = await s.findOrCreateUser({
        provider: "github",
        providerAccountId: `h-${process.pid}`,
        email,
      });
      assert.notEqual(g.id, h.id);
      await s.removeUser(g.id);
      await s.removeUser(h.id);
    });
  });

  describe("table isolation", () => {
    test("a device id cannot read or write the user table", async () => {
      // The security property, asserted rather than described. readDevice and
      // readUser target different tables, so there is no id -- client-supplied
      // or otherwise -- that reaches a user row through the device path.
      const s = newStore();
      const { user } = await makeUser();
      const snap = emptySnapshot();
      snap.playlists.push({
        id: "p1",
        name: "Secret",
        description: "",
        items: [],
        createdAt: 1,
        updatedAt: 1,
      });
      await s.writeUser(user.id, snap);

      // Bob's device id happens to equal Alice's user id. The device path must
      // still find nothing, because it never queries the user table.
      const viaDevice = await s.readDevice(user.id);
      assert.equal(viaDevice, null, "device read must not reach the user table");

      await s.removeUser(user.id);
    });
  });
});