"use client";

import { Suspense } from "react";
import { SearchResults } from "@/components/search/search-results";
import { useSearchQuery } from "@/hooks/use-search-query";

/**
 * Search results.
 *
 * Reads `?q=` so a result page is shareable and survives a reload, and binds
 * the header field to the same state.
 */
export function SearchView() {
  return (
    <Suspense fallback={<div className="pt-6 text-sm text-sub">Loading search…</div>}>
      <SearchInner />
    </Suspense>
  );
}

function SearchInner() {
  const { query, tab, setTab } = useSearchQuery();

  return (
    <div className="pt-6">
      <SearchResults query={query} tab={tab} onTabChange={setTab} />
    </div>
  );
}