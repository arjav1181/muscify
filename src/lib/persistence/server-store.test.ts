import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Backend selection.
 *
 * The scenario these exist for is not hypothetical. A CI runner, a dev box or
 * a Vercel integration can easily have `DATABASE_URL` set in the environment
 * pointing at a database that has nothing to do with muscify. A store that
 * claimed it would create and write a `muscify_library` table there — silently,
 * into someone else's data.
 *
 * `getStore` reads `process.env` and memoises, so each case installs its own
 * environment and resets the memo. The Neon case needs no database: selection
 * happens before any connection is attempted.
 */

/** Replaces the environment wholesale, restoring whatever was there before. */
function withEnv(
  vars: Record<string, string | undefined>,
  run: () => void,
): void {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    run();
  } finally {
    process.env = saved as NodeJS.ProcessEnv;
  }
}

/** Imports a fresh copy of the module so the memo starts empty. */
async function freshStore(): Promise<typeof import("./server-store")> {
  const mod = await import(`./server-store.ts?case=${Math.random()}`);
  mod.__resetStore();
  return mod;
}

/** Every variable that could enable sync, cleared. */
const NONE = {
  MUSCIFY_SYNC_BACKEND: undefined,
  MUSCIFY_SUPABASE_URL: undefined,
  MUSCIFY_SUPABASE_SERVICE_ROLE_KEY: undefined,
  MUSCIFY_SUPABASE_KEY: undefined,
  MUSCIFY_DATABASE_URL: undefined,
  SUPABASE_URL: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  SUPABASE_KEY: undefined,
  DATABASE_URL: undefined,
  NEON_DATABASE_URL: undefined,
};

test("no configuration means no backend", async () => {
  const mod = await freshStore();
  withEnv(NONE, () => {
    assert.equal(mod.getStore(), null);
  });
});

test("a bare DATABASE_URL is ignored", async () => {
  const mod = await freshStore();
  withEnv({ ...NONE, DATABASE_URL: "postgresql://user:pw@host/db" }, () => {
    assert.equal(
      mod.getStore(),
      null,
      "a database belonging to some other tool must never be claimed",
    );
  });
});

test("a bare NEON_DATABASE_URL is ignored for the same reason", async () => {
  const mod = await freshStore();
  withEnv({ ...NONE, NEON_DATABASE_URL: "postgresql://user:pw@host/db" }, () => {
    assert.equal(mod.getStore(), null);
  });
});

test("MUSCIFY_DATABASE_URL selects Neon with no opt-in flag", async () => {
  const mod = await freshStore();
  withEnv({ ...NONE, MUSCIFY_DATABASE_URL: "postgresql://user:pw@host/db" }, () => {
    const store = mod.getStore();
    assert.ok(store, "a muscify-prefixed URL is unambiguous");
    assert.equal(store!.name, "neon");
  });
});

test("the prefixed Supabase pair selects Supabase", async () => {
  const mod = await freshStore();
  withEnv(
    {
      ...NONE,
      MUSCIFY_SUPABASE_URL: "https://abc.supabase.co",
      MUSCIFY_SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    () => {
      const store = mod.getStore();
      assert.ok(store);
      assert.equal(store!.name, "supabase");
    },
  );
});

test("a Supabase URL without a key is not half-configured into existence", async () => {
  const mod = await freshStore();
  withEnv({ ...NONE, MUSCIFY_SUPABASE_URL: "https://abc.supabase.co" }, () => {
    assert.equal(
      mod.getStore(),
      null,
      "guessing the key would turn a setup mistake into an opaque 401",
    );
  });
});

test("a Supabase key without a URL is likewise ignored", async () => {
  const mod = await freshStore();
  withEnv({ ...NONE, MUSCIFY_SUPABASE_SERVICE_ROLE_KEY: "service-role-key" }, () => {
    assert.equal(mod.getStore(), null);
  });
});

test("an explicit Neon opt-in does read the generic DATABASE_URL", async () => {
  const mod = await freshStore();
  withEnv(
    { ...NONE, MUSCIFY_SYNC_BACKEND: "neon", DATABASE_URL: "postgresql://user:pw@host/db" },
    () => {
      const store = mod.getStore();
      assert.ok(store, "this is the escape hatch for a Vercel-integrated Neon project");
      assert.equal(store!.name, "neon");
    },
  );
});

test("an explicit Supabase opt-in does read the generic Supabase names", async () => {
  const mod = await freshStore();
  withEnv(
    {
      ...NONE,
      MUSCIFY_SYNC_BACKEND: "supabase",
      SUPABASE_URL: "https://abc.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    () => {
      const store = mod.getStore();
      assert.ok(store);
      assert.equal(store!.name, "supabase");
    },
  );
});

test("opting into a backend that is not configured leaves sync off, not broken", async () => {
  const mod = await freshStore();
  withEnv({ ...NONE, MUSCIFY_SYNC_BACKEND: "neon" }, () => {
    assert.equal(mod.getStore(), null, "a missing URL must not throw or half-enable");
  });
});

test("opting into Supabase without a key leaves sync off", async () => {
  const mod = await freshStore();
  withEnv({ ...NONE, MUSCIFY_SYNC_BACKEND: "supabase" }, () => {
    assert.equal(mod.getStore(), null);
  });
});

test("opting into Supabase does not fall through to Neon", async () => {
  const mod = await freshStore();
  withEnv(
    {
      ...NONE,
      MUSCIFY_SYNC_BACKEND: "supabase",
      MUSCIFY_DATABASE_URL: "postgresql://user:pw@host/db",
    },
    () => {
      assert.equal(
        mod.getStore(),
        null,
        "an explicit choice must not be quietly swapped for another backend",
      );
    },
  );
});

test("the store is memoised rather than rebuilt per request", async () => {
  const mod = await freshStore();
  withEnv({ ...NONE, MUSCIFY_DATABASE_URL: "postgresql://user:pw@host/db" }, () => {
    const first = mod.getStore();
    const second = mod.getStore();
    assert.equal(first, second, "a warm lambda must not open a second pool");
  });
});

test("the shipped schema creates the table the stores expect", async () => {
  const { SCHEMA_SQL } = await freshStore();
  const sql = SCHEMA_SQL.toLowerCase();
  for (const fragment of [
    "muscify_library",
    "device_id",
    "snapshot",
    "jsonb",
    "enable row level security",
    "service_role",
  ]) {
    assert.ok(sql.includes(fragment), `schema must mention ${fragment}`);
  }
  // RLS with no anon policy is the point; granting anon would undo it.
  assert.equal(/grant[^\n]*\bto anon\b/.test(sql), false, "anon must never be granted access");
});