"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GripVertical } from "lucide-react";

/**
 * A draggable divider that resizes the navigation panel.
 *
 * Spotify exposes this as a `Resize main navigation` slider, and REA found that
 * slider in its accessibility tree, so the accessible name here is the one
 * measured from the reference rather than invented.
 *
 * Three ways to adjust, because a resize handle that only works with a mouse is
 * a resize handle some people cannot use:
 *
 *  - drag the divider
 *  - focus it and use the arrow keys (Home/End jump to the limits)
 *  - double-click to reset
 *
 * It is a `separator` with `aria-valuenow`, which is what makes a screen reader
 * announce the width as it changes.
 */

const MIN = 180;
const MAX = 420;
/** Roughly the default: wide enough for "Listening stats" on one line. */
const DEFAULT = 240;
const KEY = "muscify:nav-width";

export function NavResizer({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, w: 0 });

  const clamp = useCallback(
    (w: number) => Math.min(MAX, Math.max(MIN, Math.round(w))),
    [],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => onChange(clamp(start.current.w + (e.clientX - start.current.x)));
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // A drag that ends outside the window would otherwise leave it stuck.
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("blur", up);
    };
  }, [dragging, onChange, clamp]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 32 : 8;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = width - step;
    else if (e.key === "ArrowRight") next = width + step;
    else if (e.key === "Home") next = MIN;
    else if (e.key === "End") next = MAX;
    else if (e.key === "Enter" || e.key === " ") next = DEFAULT;
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(next));
  };

  return (
    <div
      role="separator"
      aria-label="Resize main navigation"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(DEFAULT)}
      onPointerDown={(e) => {
        e.preventDefault();
        start.current = { x: e.clientX, w: width };
        setDragging(true);
      }}
      title="Drag to resize · arrow keys to nudge · double-click to reset"
      className={
        "group relative -ml-1 hidden w-2 shrink-0 cursor-col-resize touch-none md:block " +
        "outline-none focus-visible:bg-spotify/60 " +
        (dragging ? "bg-spotify/60" : "hover:bg-white/10")
      }
    >
      {/* The visible hairline. Only on hover, so it does not add permanent
          chrome to a layout that is otherwise clean. */}
      <span
        aria-hidden
        className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-white/0 transition group-hover:bg-white/20"
      />
      <GripVertical
        size={12}
        aria-hidden
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-sub opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </div>
  );
}

/**
 * The chosen width, as an external store backed by localStorage.
 *
 * `useSyncExternalStore` rather than `useState` + an effect. An effect that
 * reads localStorage and calls setState is the shape React warns about, and it
 * genuinely does cost an extra render on every mount -- this reads the stored
 * width during the first client render instead, with the server snapshot being
 * the default so hydration still matches and upgrades on the client.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readWidth(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT;
    // A stored value from an older build, or a hand-edited one, is clamped
    // rather than trusted -- otherwise a width of 9000 would push the main
    // content off screen with no way to drag back.
    return Math.min(MAX, Math.max(MIN, Math.round(n)));
  } catch {
    return DEFAULT;
  }
}

function writeWidth(w: number) {
  try {
    window.localStorage.setItem(KEY, String(w));
  } catch {
    // Private mode. The width still applies for this session, it just does not
    // survive a reload, which is cosmetic rather than broken.
  }
  for (const l of listeners) l();
}

export function useNavWidth(): [number, (w: number) => void] {
  const width = useSyncExternalStore(subscribe, readWidth, () => DEFAULT);
  const set = useCallback((w: number) => writeWidth(Math.min(MAX, Math.max(MIN, w))), []);
  return [width, set];
}
