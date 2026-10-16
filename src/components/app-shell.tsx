"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { PlayerHost } from "@/components/player/player-host";
import { PlayerBar } from "@/components/player/player-bar";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { ContextMenu } from "@/components/context-menu";
import { Toasts } from "@/components/toasts";
import { ModalHost } from "@/components/modal-host";
import { LyricsPanel } from "@/components/player/lyrics-panel";
import { GlobalEffects } from "@/components/global-effects";
import { useLibrary } from "@/store/library-store";
import { useUi } from "@/store/ui-store";

/**
 * App frame, wrapping every route.
 *
 * Deliberately client-side and persistent: the player, queue and library all
 * live in Zustand stores that must survive navigation, so routes render inside
 * this one shell rather than each mounting their own chrome.
 *
 * The shell itself avoids route-dependent hooks so it stays prerenderable — the
 * two pieces that need `usePathname()` (sidebar, mobile nav) each sit behind
 * their own Suspense boundary instead of blocking the whole tree.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const lyricsOpen = useUi((s) => s.lyricsOpen);
  const ready = useLibrary((s) => s.ready);

  return (
    <>
      <PlayerHost />
      <GlobalEffects />

      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden p-2">
        <div className="hidden shrink-0 md:block">
          <Suspense fallback={<div className="h-full w-[260px]" />}>
            <Sidebar />
          </Suspense>
        </div>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface">
          <TopBar />
          <Suspense fallback={<div className="h-10 md:hidden" />}>
            <MobileNav />
          </Suspense>
          <div id="muscify-scroll" className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 md:px-6">
            {ready ? children : <BootSkeleton />}
          </div>
        </main>
      </div>

      {lyricsOpen ? (
        <div className="fixed inset-y-0 right-0 z-40 hidden w-[380px] lg:block">
          <LyricsPanel />
        </div>
      ) : null}

      <PlayerBar />
      <ContextMenu />
      <Toasts />
      <ModalHost />
    </>
  );
}

function BootSkeleton() {
  return (
    <div className="animate-pulse pt-6">
      <div className="mb-6 h-8 w-52 rounded bg-highlight" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i}>
            <div className="mb-4 aspect-square rounded bg-highlight" />
            <div className="mb-2 h-3 w-4/5 rounded bg-highlight" />
            <div className="h-3 w-3/5 rounded bg-highlight" />
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileNav() {
  const pathname = usePathname();
  const links = [
    ["/", "Home"],
    ["/search", "Search"],
    ["/library", "Library"],
    ["/radio", "Radio"],
  ] as const;

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line px-2 py-2 md:hidden">
      {links.map(([href, label]) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <a
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              active ? "bg-on text-black" : "bg-highlight text-sub"
            }`}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}