"use client";

import { useEffect, useState } from "react";
import { useUi, type ContextItem } from "@/store/ui-store";

/**
 * Spotify-style right-click menu.
 *
 * Fixed-position at the viewport so it escapes any overflow or stacking
 * context on the row that opened it, with a submenu that reveals on hover.
 */
export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  const close = useUi((s) => s.closeContextMenu);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest("[data-context-menu]")) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, close]);

  if (!menu) return null;

  return (
    <div
      data-context-menu
      role="menu"
      aria-label="Track actions"
      style={{ left: menu.x, top: menu.y }}
      className="fixed z-[80] min-w-[210px] overflow-hidden rounded-md border border-line bg-elevated py-1 shadow-2xl"
    >
      {menu.items.map((item, i) => (
        <MenuEntry key={`${item.label}-${i}`} item={item} />
      ))}
    </div>
  );
}

function MenuEntry({ item }: { item: ContextItem }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        role="menuitem"
        disabled={item.disabled}
        onClick={() => {
          if (item.children) return;
          item.run?.();
          useUi.getState().closeContextMenu();
        }}
        className={`flex w-full items-center justify-between gap-6 px-4 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          item.danger ? "text-red-400 hover:bg-highlight" : "text-on hover:bg-highlight"
        }`}
      >
        <span className="truncate">{item.label}</span>
        {item.children ? <span aria-hidden className="text-dim">›</span> : null}
      </button>

      {item.children && hovered ? (
        <div
          role="menu"
          aria-label={item.label}
          className="border-t border-line bg-base/70 py-1"
        >
          {item.children.length ? (
            item.children.map((child, i) => (
              <button
                key={`${child.label}-${i}`}
                role="menuitem"
                onClick={() => {
                  // Run after the menu unmounts, so the mutation's re-render
                  // doesn't race the menu closing.
                  queueMicrotask(() => {
                    child.run?.();
                    useUi.getState().closeContextMenu();
                  });
                }}
                className="block w-full truncate px-4 py-2 text-left text-sm text-on transition-colors hover:bg-highlight"
              >
                {child.label}
              </button>
            ))
          ) : (
            <p className="px-4 py-2 text-xs text-dim">No playlists yet</p>
          )}
        </div>
      ) : null}
    </div>
  );
}