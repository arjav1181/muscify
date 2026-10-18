import { test } from "node:test";
import assert from "node:assert/strict";

import {
  emptySnapshot,
  type LibrarySnapshot,
  type LibraryRepository,
} from "./types.ts";

/**
 * The syncing repository's whole job is behaving correctly when things are
 * absent, unreachable, slow or hostile. Those are the cases worth testing: the
 * happy path is `localStorage.setItem`.
 *
 * `window` and `fetch` are stubbed because the module reads both at call time
 * rather than import time, so the stubs can be installed before each scenario.
 */

/** Minimal localStorage. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
  };
}

/** A localStorage-shaped global with no `localStorage` (private mode). */
function brokenStorage() {
  return {
    getItem() {
      throw new DOMException("denied", "SecurityError");
    },
    setItem() {
      throw new DOMException("denied", "SecurityError");
    },
    removeItem() {},
  };
}

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Harness {
  calls: { url: string; method: string; body?: string }[];
  setHandler(handler: Handler): void;
  storage: ReturnType<typeof fakeStorage>;
  restore(): void;
}

/** Installs the browser globals the module needs. */
function harness(opts: { storage?: "none" } = {}): Harness {
  const storage = fakeStorage();
  const calls: { url: string; method: string; body?: string }[] = [];
  let handler: Handler = async () => jsonResponse({ ok: true, snapshot: null });

  const g = globalThis as Record<string, unknown>;
  const savedWindow = g.window;
  const savedFetch = g.fetch;
  const savedNavigator = Object.getOwnPropertyDescriptor(g, "navigator");

  g.window = {
    localStorage: opts.storage === "none" ? brokenStorage() : storage,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  // Node defines `navigator` as a getter-only property, so a plain assignment
  // throws. defineProperty is the only way to stub it.
  Object.defineProperty(g, "navigator", {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });
  g.fetch = async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return handler(url, init);
  };

  return {
    calls,
    storage,
    setHandler(next: Handler) {
      handler = next;
    },
    restore() {
      g.window = savedWindow;
      g.fetch = savedFetch;
      if (savedNavigator) Object.defineProperty(g, "navigator", savedNavigator);
      else delete g.navigator;
    },
  };
}

/**
 * Builds a snapshot stamped at a given time.
 *
 * The values have to be real epoch milliseconds: `save` overwrites `updatedAt`
 * with `Date.now()`, so a "newer" server copy is one with a timestamp after
 * now, not a larger small number.
 */
const NOW = Date.now();

function snapshotAt(updatedAt: number, name = "Playlist"): LibrarySnapshot {
  const snap = emptySnapshot();
  return {
    ...snap,
    playlists: [
      {
        id: "p1",
        name,
        description: "",
        items: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    updatedAt,
  } as LibrarySnapshot;
}

/** Calls `pull` with the outcome type, so the tests exercise the real shape. */
async function pull(repo: LibraryRepository) {
  return (repo as unknown as { pull(): Promise<import("./sync.ts").SyncOutcome> }).pull();
}

/** Loads the module fresh so it does not capture a previous stub. */
async function loadModule(): Promise<typeof import("./sync")> {
  return import(`./sync.ts?fresh=${Math.random()}`);
}

test("createRepository yields a usable repository with no backend present", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    const repo = createRepository();

    // The three methods the interface requires, plus the durable flag. Nothing
    // here may be missing, because there is no branch in the app that can cope
    // with a repository that throws on construction.
    assert.equal(typeof repo.load, "function");
    assert.equal(typeof repo.save, "function");
    assert.equal(typeof repo.clear, "function");
    assert.equal(typeof repo.durable, "boolean");

    const loaded = await repo.load();
    assert.equal(loaded.version, emptySnapshot().version, "a clean install, not undefined");
  } finally {
    h.restore();
  }
});

test("load never touches the network", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    await createRepository().load();
    assert.deepEqual(h.calls, [], "boot must not wait on the server");
  } finally {
    h.restore();
  }
});

test("save writes locally before it attempts the server", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    const repo = createRepository();

    await repo.save(snapshotAt(500, "Local write"));
    // The local write has already happened even though the push is in flight.
    const stored = JSON.parse(h.storage.getItem("muscify:library:v1")!) as LibrarySnapshot;
    assert.equal(stored.playlists[0]!.name, "Local write");

    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0]!.method, "PUT");
  } finally {
    h.restore();
  }
});

test("a 501 switches sync off and stops it being retried", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    h.setHandler(async () => jsonResponse({ ok: false }, 501));

    const repo = createRepository();
    for (let i = 0; i < 5; i++) {
      await repo.save(snapshotAt(1000 + i));
      await new Promise((r) => setTimeout(r, 0));
    }

    assert.equal(h.calls.length, 1, "one probe, then silence for the rest of the session");
    assert.equal(repo.durable, false);
  } finally {
    h.restore();
  }
});

test("a 404 also counts as no backend configured", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    h.setHandler(async () => jsonResponse({}, 404));
    const repo = createRepository();
    await repo.save(snapshotAt(1));
    await new Promise((r) => setTimeout(r, 0));
    await repo.save(snapshotAt(2));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.calls.length, 1);
  } finally {
    h.restore();
  }
});

test("a server failure still leaves the local write intact", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    h.setHandler(async () => jsonResponse({ ok: false }, 502));

    const repo = createRepository();
    await repo.save(snapshotAt(500, "Survives a 502"));
    await new Promise((r) => setTimeout(r, 0));

    const reloaded = await repo.load();
    assert.equal(reloaded.playlists[0]!.name, "Survives a 502");
  } finally {
    h.restore();
  }
});

test("pull adopts a newer server copy", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    const repo = createRepository();

    // Local has an older write.
    await repo.save(snapshotAt(NOW - 60_000, "Older"));
    await new Promise((r) => setTimeout(r, 0));

    // The server copy is stamped after the local save, which is how "another
    // device wrote this more recently" looks from here.
    h.setHandler(async () => jsonResponse({ ok: true, snapshot: snapshotAt(NOW + 60_000, "Newer") }));

    const outcome = await pull(repo);
    assert.equal(outcome.status, "synced");
    assert.equal(outcome.snapshot!.playlists[0]!.name, "Newer");

    // And it must have landed locally, so the next cold start agrees.
    const reloaded = await repo.load();
    assert.equal(reloaded.playlists[0]!.name, "Newer");
  } finally {
    h.restore();
  }
});

test("pull keeps the local copy when the server is not newer", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    const repo = createRepository();

    await repo.save(snapshotAt(NOW + 60_000, "Newer"));
    await new Promise((r) => setTimeout(r, 0));

    h.setHandler(async () => jsonResponse({ ok: true, snapshot: snapshotAt(NOW - 60_000, "Older") }));

    const outcome = await pull(repo);
    assert.equal(outcome.status, "synced");
    assert.equal(outcome.snapshot, null, "an older server copy must not clobber local edits");
    assert.equal((await repo.load()).playlists[0]!.name, "Newer");
  } finally {
    h.restore();
  }
});

test("pull treats a null snapshot as first run, not failure", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    const repo = createRepository();
    await repo.save(snapshotAt(NOW, "Local"));
    await new Promise((r) => setTimeout(r, 0));

    h.setHandler(async () => jsonResponse({ ok: true, snapshot: null }));
    const outcome = await pull(repo);

    assert.equal(outcome.status, "synced", "first run is not a failure");
    assert.equal(outcome.snapshot, null);
    assert.equal((await repo.load()).playlists[0]!.name, "Local", "local survives");
    assert.equal(repo.durable, true, "the server answered, so it counts as reachable");
  } finally {
    h.restore();
  }
});

test("a corrupt server row cannot break the app or be overwritten", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    const repo = createRepository();
    await repo.save(snapshotAt(NOW, "Local truth"));
    await new Promise((r) => setTimeout(r, 0));

    // Well-formed HTTP, junk body.
    h.setHandler(async () => new Response("{not json", { status: 200 }));

    const outcome = await pull(repo);
    // A body that will not parse is not a sync, it is something intercepting
    // the request — so it reports as unreachable rather than claiming success.
    assert.equal(outcome.status, "unreachable");
    assert.equal(
      (await repo.load()).playlists[0]!.name,
      "Local truth",
      "local must not be replaced by unparseable data",
    );
  } finally {
    h.restore();
  }
});

test("a server error response pulls nothing", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    h.setHandler(async () => jsonResponse({ ok: false, reason: "read failed" }, 502));
    const repo = createRepository();
    const outcome = await pull(repo);
    assert.equal(outcome.status, "unreachable", "a configured server that fails is not 'off'");
  } finally {
    h.restore();
  }
});

test("an unreachable server never throws out of pull", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    h.setHandler(async () => {
      throw new TypeError("network down");
    });
    const repo = createRepository();
    const outcome = await pull(repo);
    assert.equal(outcome.status, "unreachable");
  } finally {
    h.restore();
  }
});

test("save stamps the snapshot so the next pull can compare", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    let pushed: LibrarySnapshot | null = null;
    h.setHandler(async (_url, init) => {
      if (init?.body) pushed = JSON.parse(init.body as string) as LibrarySnapshot;
      return jsonResponse({ ok: true });
    });

    // No updatedAt on the input at all.
    const repo = createRepository();
    const before = Date.now();
    await repo.save(emptySnapshot());
    await new Promise((r) => setTimeout(r, 0));

    assert.ok(pushed, "a push should have happened");
    const stamped = (pushed as unknown as { updatedAt?: number }).updatedAt;
    assert.ok(typeof stamped === "number" && stamped >= before, "the write must carry a clock");
  } finally {
    h.restore();
  }
});

test("the device id survives a library clear", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    const first = createRepository();
    await first.save(snapshotAt(1));
    await new Promise((r) => setTimeout(r, 0));
    const id = h.storage.getItem("muscify:device");
    assert.ok(id, "a device id is minted on first use");

    // "Delete everything" must not also destroy the sync identity, or the next
    // save would silently fork a new one and the server would keep two rows.
    await first.clear();
    assert.equal(h.storage.getItem("muscify:device"), id);
  } finally {
    h.restore();
  }
});

test("the device id is reused across repositories in the same browser", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    h.setHandler(async () => jsonResponse({ ok: true }));

    const a = createRepository();
    await a.save(snapshotAt(1));
    await new Promise((r) => setTimeout(r, 0));
    const firstId = h.calls[0] ? h.storage.getItem("muscify:device") : null;

    const b = createRepository();
    await b.save(snapshotAt(2));
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(h.storage.getItem("muscify:device"), firstId, "identity is per browser");
  } finally {
    h.restore();
  }
});

test("private mode still saves, just without sync", async () => {
  const h = harness({ storage: "none" });
  try {
    const { createRepository } = await loadModule();
    const repo = createRepository();

    await repo.save(snapshotAt(1, "In memory"));
    await new Promise((r) => setTimeout(r, 0));

    const reloaded = await repo.load();
    assert.equal(reloaded.playlists[0]!.name, "In memory");
    assert.equal(repo.durable, false, "the UI must be able to say so");
  } finally {
    h.restore();
  }
});

test("clear removes the server row too", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    h.setHandler(async () => jsonResponse({ ok: true }));
    const repo = createRepository();
    await repo.clear();
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(h.calls[0]!.method, "DELETE");
    assert.equal((await repo.load()).playlists.length, 0);
  } finally {
    h.restore();
  }
});
test("a well-formed but corrupt row is a clean no-op, not a failure", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    const repo = createRepository();
    await repo.save(snapshotAt(NOW, "Local truth"));
    await new Promise((r) => setTimeout(r, 0));

    // Valid JSON envelope, but the snapshot inside is junk that migrate refuses
    // by coming back empty. Reporting this as "synced, nothing adopted" is what
    // stops the next push from overwriting the server row with nothing.
    h.setHandler(async () =>
      jsonResponse({ ok: true, snapshot: { version: 99, playlists: "not an array" } }),
    );

    const outcome = await pull(repo);
    assert.equal(outcome.status, "synced", "the server did answer");
    assert.equal(outcome.snapshot, null, "but nothing was adopted");
    assert.equal((await repo.load()).playlists[0]!.name, "Local truth");
  } finally {
    h.restore();
  }
});

test("pull reports off once a save has learned sync is not configured", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    h.setHandler(async () => jsonResponse({ ok: false }, 501));

    const repo = createRepository();
    await repo.save(snapshotAt(NOW));
    await new Promise((r) => setTimeout(r, 0));

    const outcome = await pull(repo);
    assert.equal(outcome.status, "off", "one 501, and the status says so plainly");
    assert.equal(
      h.calls.length,
      1,
      "the pull was answered from the remembered verdict, not by asking again",
    );
  } finally {
    h.restore();
  }
});

test("durable needs both halves, not just local storage", async () => {
  const h = harness();
  try {
    const { createRepository } = await loadModule();
    h.setHandler(async () => jsonResponse({ ok: true, snapshot: null }));

    const repo = createRepository();
    // Local works, but the server has never confirmed itself yet.
    assert.equal(repo.durable, false, "an unverified backend is not a durable one");

    await pull(repo);
    assert.equal(repo.durable, true, "after the server answers, it is");
  } finally {
    h.restore();
  }
});
