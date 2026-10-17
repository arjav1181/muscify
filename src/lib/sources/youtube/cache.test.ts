import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cached,
  cacheKey,
  cacheSize,
  canSpend,
  isQuotaError,
  quotaStatus,
  resetCache,
  UNIT_COST,
} from "./cache.ts";

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

function fresh() {
  resetCache(T0);
}

/** A fetcher that counts its calls, so quota spend is observable. */
function counting(value: unknown = { ok: true }) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    fetch: async () => {
      calls += 1;
      return value;
    },
  };
}

test("cache key is order-independent", () => {
  assert.equal(
    cacheKey("search", { b: "2", a: "1" }),
    cacheKey("search", { a: "1", b: "2" }),
    "parameter order must not fragment the cache",
  );
  assert.notEqual(cacheKey("search", { a: "1" }), cacheKey("channels", { a: "1" }));
});

test("a fresh entry costs one call, then none", async () => {
  fresh();
  const spy = counting();
  const params = { q: "pritam" };

  const a = await cached("search", params, HOUR, spy.fetch, T0);
  const b = await cached("search", params, HOUR, spy.fetch, T0 + 60_000);

  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(b.stale, false);
  assert.equal(spy.calls, 1, "second read must not hit the network");
});

test("different queries are cached separately", async () => {
  fresh();
  const spy = counting();
  await cached("search", { q: "a" }, HOUR, spy.fetch, T0);
  await cached("search", { q: "b" }, HOUR, spy.fetch, T0);
  assert.equal(spy.calls, 2);
  assert.equal(cacheSize(), 2);
});

test("an entry expires and is refetched", async () => {
  fresh();
  const spy = counting();
  await cached("search", { q: "x" }, HOUR, spy.fetch, T0);
  await cached("search", { q: "x" }, HOUR, spy.fetch, T0 + HOUR + 1);
  assert.equal(spy.calls, 2, "past the TTL it must refetch");
});

test("concurrent identical requests cost one call", async () => {
  fresh();
  let calls = 0;
  const slow = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 25));
    return { ok: true };
  };

  const results = await Promise.all([
    cached("search", { q: "same" }, HOUR, slow, T0),
    cached("search", { q: "same" }, HOUR, slow, T0),
    cached("search", { q: "same" }, HOUR, slow, T0),
  ]);

  assert.equal(calls, 1, "single-flight must collapse concurrent duplicates");
  assert.equal(results.length, 3);
  assert.deepEqual(results[0]!.value, results[2]!.value);
});

test("a quota error serves the previous value instead of failing", async () => {
  fresh();
  const params = { q: "pritam" };
  await cached("search", params, HOUR, async () => ({ tracks: ["a"] }), T0);

  // Past the TTL, so it must refetch — and the refetch fails.
  const outcome = await cached(
    "search",
    params,
    HOUR,
    async () => {
      throw new Error("search failed (quota exceeded)");
    },
    T0 + HOUR + 1,
  );

  assert.equal(outcome.stale, true, "a stale answer beats an error");
  assert.equal(outcome.cached, true);
  assert.deepEqual(outcome.value, { tracks: ["a"] });
});

test("a non-quota error still propagates", async () => {
  fresh();
  const outcome = await cached(
    "search",
    { q: "bad" },
    HOUR,
    async () => {
      throw new Error("search failed (status 400)");
    },
    T0,
  ).catch((e: Error) => e);

  assert.ok(outcome instanceof Error, "a 400 must not be silently cached");
  assert.match(outcome.message, /400/);
});

test("quota errors are recognised, other errors are not", () => {
  assert.equal(isQuotaError(new Error("429 Too Many Requests")), true);
  assert.equal(isQuotaError(new Error("quota exceeded")), true);
  assert.equal(isQuotaError(new Error("rate limit reached")), true);
  assert.equal(isQuotaError(new Error("status 400")), false);
  assert.equal(isQuotaError(new Error("network down")), false);
});

test("each call charges its endpoint's unit cost", async () => {
  fresh();
  const spy = counting();
  await cached("search", { q: "a" }, HOUR, spy.fetch, T0);
  await cached("channels", { id: "x" }, HOUR, spy.fetch, T0);

  assert.equal(quotaStatus(T0).used, UNIT_COST.search + UNIT_COST.channels);
  assert.equal(UNIT_COST.search, 100, "search.list is the expensive one");
  assert.ok(UNIT_COST.search > UNIT_COST.channels * 50);
});

test("the budget is spent after enough searches and then refuses", async () => {
  fresh();
  const spy = counting();
  // Distinct queries, so each is a genuine miss.
  for (let i = 0; i < 95; i++) {
    await cached("search", { q: `q${i}` }, HOUR, spy.fetch, T0).catch(() => undefined);
  }

  const status = quotaStatus(T0);
  assert.equal(status.exhausted, true, "the ledger must know it is spent");
  assert.ok(status.used >= status.budget);
  assert.equal(canSpend(100, T0), false);
  assert.equal(status.usedFraction, 1);

  // A further search must be refused rather than collecting another 429.
  const callsBefore = spy.calls;
  await cached("search", { q: "one-more" }, HOUR, spy.fetch, T0).catch(() => undefined);
  assert.equal(spy.calls, callsBefore, "no upstream call once the budget is gone");
});

test("an exhausted budget still serves cached results", async () => {
  fresh();
  await cached("search", { q: "known" }, HOUR, async () => ({ tracks: ["cached"] }), T0);

  const spy = counting();
  for (let i = 0; i < 95; i++) {
    await cached("search", { q: `burn${i}` }, HOUR, spy.fetch, T0).catch(() => undefined);
  }

  const outcome = await cached("search", { q: "known" }, HOUR, spy.fetch, T0);
  assert.deepEqual(outcome.value, { tracks: ["cached"] }, "cached answers survive exhaustion");
});

test("quota resets on a new day", async () => {
  fresh();
  const spy = counting();
  for (let i = 0; i < 95; i++) {
    await cached("search", { q: `q${i}` }, HOUR, spy.fetch, T0).catch(() => undefined);
  }
  assert.equal(quotaStatus(T0).exhausted, true);

  const nextDay = T0 + 86_400_000 + 1000;
  assert.equal(quotaStatus(nextDay).used, 0, "the ledger must reset");
  assert.equal(quotaStatus(nextDay).exhausted, false);
});

test("stale answers are abandoned once they are too old to be useful", async () => {
  fresh();
  const params = { q: "old" };
  await cached("search", params, HOUR, async () => ({ v: 1 }), T0);

  const outcome = await cached(
    "search",
    params,
    HOUR,
    async () => {
      throw new Error("429 rate limit");
    },
    T0 + 48 * HOUR,
  ).catch((e: Error) => e);

  assert.ok(outcome instanceof Error, "a two-day-old answer must not be served");
});

test("cache size reflects distinct entries", async () => {
  fresh();
  const spy = counting();
  await cached("search", { q: "a" }, HOUR, spy.fetch, T0);
  await cached("search", { q: "a", extra: "1" }, HOUR, spy.fetch, T0);
  assert.equal(cacheSize(), 2);
});

test("quota status exposes a reset time in the future", () => {
  fresh();
  const status = quotaStatus(T0);
  assert.ok(status.resetsAt > T0, "reset must be ahead of now");
  assert.equal(status.budget > 0, true);
});