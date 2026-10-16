"use client";

import { useEffect, useState } from "react";

/**
 * Debounces a value.
 *
 * The pending timer means no setState happens synchronously in the effect
 * body, so consumers only re-render once per settled value rather than on
 * every keystroke.
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}