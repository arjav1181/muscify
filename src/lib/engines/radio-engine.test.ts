import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * CORS verdict caching and prewarm.
 *
 * `corsAllowsTapping` is a browser `fetch`, so its result depends on the
 * response actually being readable — which is the whole point. A server that
 * sends no `Access-Control-Allow-Origin` makes the fetch reject rather than
 * return a header-less response, and that must read as "not analysable" so the
 * engine never sets `crossOrigin` and silences the stream.
 *
 * Verdicts are module-level and shared across engine instances, which is what
 * makes prewarm useful: the radio page warms them once, and every later `load()`
 * takes its synchronous path.
 */

/** Installs a `fetch` that reports CORS per URL. */
function withFetch(
  handler: (url: string) => Response | Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  const saved = g.fetch;
  const seen: string[] = [];

  g.fetch = async (url: string) => {
    seen.push(url);
    return handler(url);
  };

  return Promise.resolve()
    .then(run)
    .finally(() => {
      g.fetch = saved;
    });
}

/** A URL set large enough to exercise the cap. */
const many = (n: number) => Array.from({ length: n }, (_, i) => `https://ice.example/s${i}.mp3`);

/** A fresh module, so the verdict cache starts empty. */
async function fresh() {
  return import(`./radio-engine.ts?t=${Math.random()}`);
}

function allowsOrigin(res: Response, origin: string | null) {
  if (origin === null) return new Response(null, { status: 204 });
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin } });
}

test("a permissive origin is analysable", async () => {
  const mod = await fresh();
  await withFetch(
    async () => allowsOrigin(new Response(), "*"),
    async () => {
      assert.equal(await mod.__testing.allowsTapping("https://a.example/s.mp3"), true);
    },
  );
});

test("an origin that echoes back is analysable", async () => {
  const mod = await fresh();
  await withFetch(
    async () => allowsOrigin(new Response(), "https://muscify.example"),
    async () => {
      assert.equal(await mod.__testing.allowsTapping("https://b.example/s.mp3"), true);
    },
  );
});

test("a missing CORS header is not analysable", async () => {
  const mod = await fresh();
  await withFetch(
    async () => allowsOrigin(new Response(), null),
    async () => {
      assert.equal(await mod.__testing.allowsTapping("https://c.example/s.mp3"), false);
    },
  );
});

test("a nonsense header value is not analysable", async () => {
  const mod = await fresh();
  await withFetch(
    async () => allowsOrigin(new Response(), "null"),
    async () => {
      // "null" is what a sandboxed/opaque origin sends, and it is not a usable
      // http(s) origin, so it must not be treated as permission.
      assert.equal(await mod.__testing.allowsTapping("https://d.example/s.mp3"), false);
    },
  );
});

test("a rejected fetch — what a non-CORS server actually produces — is not analysable", async () => {
  const mod = await fresh();
  await withFetch(
    async () => {
      throw new TypeError("Failed to fetch");
    },
    async () => {
      assert.equal(
        await mod.__testing.allowsTapping("https://e.example/s.mp3"),
        false,
        "this is the case that would otherwise silence the stream",
      );
    },
  );
});

test("a verdict is asked for once, not per play", async () => {
  const mod = await fresh();
  let calls = 0;
  await withFetch(
    async () => {
      calls++;
      return allowsOrigin(new Response(), "*");
    },
    async () => {
      const url = "https://f.example/s.mp3";
      await mod.__testing.allowsTapping(url);
      await mod.__testing.allowsTapping(url);
      await mod.__testing.allowsTapping(url);
      assert.equal(calls, 1, "the whole point of caching it");
    },
  );
});

test("concurrent asks collapse into one request", async () => {
  const mod = await fresh();
  let calls = 0;
  await withFetch(
    async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return allowsOrigin(new Response(), "*");
    },
    async () => {
      const url = "https://g.example/s.mp3";
      const results = await Promise.all([
        mod.__testing.allowsTapping(url),
        mod.__testing.allowsTapping(url),
        mod.__testing.allowsTapping(url),
      ]);
      assert.deepEqual(results, [true, true, true]);
      assert.equal(calls, 1, "three stations rendering at once must not triple the requests");
    },
  );
});

test("prewarm dedupes and respects its cap", async () => {
  const mod = await fresh();
  const urls = many(200);
  await withFetch(
    async () => allowsOrigin(new Response(), "*"),
    async () => {
      // Every URL twice, plus a cap well under the list length.
      mod.prewarmTapping([...urls, ...urls], 10);
      await new Promise((r) => setTimeout(r, 60));
      assert.equal(mod.__testing.verdictCacheSize() <= 10, true, "must not probe the whole directory");
    },
  );
});

test("prewarm skips stations whose verdict is already known", async () => {
  const mod = await fresh();
  let calls = 0;
  await withFetch(
    async () => {
      calls++;
      return allowsOrigin(new Response(), "*");
    },
    async () => {
      await mod.__testing.allowsTapping("https://h.example/known.mp3");
      assert.equal(calls, 1);

      mod.prewarmTapping(["https://h.example/known.mp3"]);
      await new Promise((r) => setTimeout(r, 40));
      assert.equal(calls, 1, "already answered, so no second request");
    },
  );
});

test("prewarm ignores empty and malformed entries", async () => {
  const mod = await fresh();
  await withFetch(
    async () => allowsOrigin(new Response(), "*"),
    async () => {
      // Must not throw on undefined, empty strings or nulls from a directory
      // that has entries with no stream.
      mod.prewarmTapping(["", undefined as never, null as never, "https://i.example/ok.mp3"]);
      await new Promise((r) => setTimeout(r, 40));
      assert.equal(await mod.__testing.allowsTapping("https://i.example/ok.mp3"), true);
    },
  );
});

test("an empty list is a no-op", async () => {
  const mod = await fresh();
  let calls = 0;
  await withFetch(
    async () => {
      calls++;
      return allowsOrigin(new Response(), "*");
    },
    async () => {
      mod.prewarmTapping([]);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(calls, 0);
    },
  );
});