import { NextResponse } from "next/server";
import { quotaStatus, cacheSize } from "@/lib/sources/youtube/cache";

/**
 * YouTube quota and cache state.
 *
 * Exists so the 429 is never a mystery. When results stop appearing, this is
 * the difference between "YouTube is out of quota for today, resets at
 * midnight UTC, everything else still works" and an empty shelf with no
 * explanation.
 *
 * The ledger lives in the module instance, so on serverless it reflects this
 * warm instance's usage rather than the whole account's. It is a useful
 * indicator, not an authoritative usage figure — the dashboard is that.
 */
export async function GET() {
  const quota = quotaStatus();

  return NextResponse.json(
    {
      used: quota.used,
      budget: quota.budget,
      usedFraction: Math.round(quota.usedFraction * 100) / 100,
      exhausted: quota.exhausted,
      resetsAt: new Date(quota.resetsAt).toISOString(),
      cachedEntries: cacheSize(),
      // search.list costs 100 units, so this is the honest remaining headroom
      // expressed in the unit that actually matters.
      searchesLeft: Math.max(0, Math.floor((quota.budget - quota.used) / 100)),
    },
    // Never cached: this is live state, and a stale reading is worse than none.
    { headers: { "Cache-Control": "no-store" } },
  );
}