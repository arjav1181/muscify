"use client";

import { useEffect } from "react";
import { useLibrary } from "@/store/library-store";

/**
 * Hydrates the persisted library once, at the root.
 *
 * Reading storage is async so it doesn't block the first paint, which means
 * the library is briefly empty. The shell gates rendering on `ready` so views
 * never flash an empty state before the real data lands.
 */
export function LibraryHydrator() {
  useEffect(() => {
    void useLibrary.getState().init();
  }, []);
  return null;
}