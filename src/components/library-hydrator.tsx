"use client";

import { useEffect } from "react";
import { useLibrary } from "@/store/library-store";

/**
 * Hydrates the persisted library once, at the root.
 *
 * Reading storage is async so it doesn't block the first paint, which means
 * the library is briefly empty. The shell gates rendering on `ready` so views
 * never flash an empty state before the real data lands.
 *
 * After that the optional server sync runs, deliberately not awaited by the
 * boot path: with no backend configured it is one 501 and then nothing, and
 * even with one configured the listener has their local library on screen while
 * the request is in flight. A newer copy is adopted when it arrives, in place,
 * without a second loading state.
 *
 * Sync also runs when the tab comes back online, because the common case for a
 * changed library is a phone that was offline — nothing to do if the answer is
 * "nothing newer".
 */
export function LibraryHydrator() {
  useEffect(() => {
    const store = useLibrary.getState();
    void store.init();

    void store.sync();

    const onOnline = () => void useLibrary.getState().sync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return null;
}