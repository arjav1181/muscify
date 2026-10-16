"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { SearchTab } from "@/lib/types";
import { useUi } from "@/store/ui-store";

const TABS: SearchTab[] = [
  "all",
  "songs",
  "videos",
  "artists",
  "albums",
  "playlists",
  "radio",
];

/**
 * Two-way binding between the search view and the URL.
 *
 * `?q=` and `?tab=` make a result page shareable and survive a reload, while
 * the ui-store keeps the header field in sync so typing feels instant without
 * pushing a history entry per keystroke.
 */
export function useSearchQuery(): {
  query: string;
  tab: SearchTab;
  setTab: (tab: SearchTab) => void;
} {
  const params = useSearchParams();
  const router = useRouter();

  const urlQuery = params.get("q") ?? "";
  const rawTab = (params.get("tab") ?? "all").toLowerCase();
  const tab = TABS.find((t) => t === rawTab) ?? "all";

  const storeQuery = useUi((s) => s.query);

  // Adopt the URL on first mount / hard navigation, but don't fight the user's
  // typing once they're in the field.
  useEffect(() => {
    if (urlQuery && urlQuery !== storeQuery) useUi.getState().setQuery(urlQuery);
    // Intentionally runs only when the URL value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  const setTab = (next: SearchTab) => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    if (urlQuery) params.set("q", urlQuery);
    router.replace(`/search?${params}`, { scroll: false });
  };

  return { query: urlQuery || storeQuery, tab, setTab };
}