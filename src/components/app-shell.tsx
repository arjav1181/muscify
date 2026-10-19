"use client";

import { Suspense } from "react";
import { PlayerHost } from "@/components/player/player-host";
import { PlayerBar } from "@/components/player/player-bar";
import { NavResizer, useNavWidth } from "@/components/nav-resizer";
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
  const [navWidth, setNavWidth] = useNavWidth();

  return (
    <>
      <PlayerHost />
      <GlobalEffects />

      {/*
        Skip link. Invisible until focused, then pinned to the top-left. A
        keyboard user would otherwise tab through the whole sidebar — logo,
        seven nav items, the create button — on every single page.
      */}
      <a
        href="#muscify-scroll"
        className="sr-only rounded-full bg-white px-4 py-2 text-sm font-medium text-black focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      {/*
        Global nav spans the full width above everything, on solid black.

        It used to sit inside the content panel, which meant the logo floated
        over whatever the current page happened to render and the search field
        inherited that page's tint. Both read as unconsidered. Two fixed black
        surfaces — this and the player bar — with the inset content panels
        between them is the arrangement that makes the frame read as deliberate.
      */}
      <div className="shrink-0 bg-black">
        <TopBar />
      </div>

      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden p-2">
        <div className="hidden shrink-0 items-stretch md:flex">
          <div style={{ width: navWidth }} className="min-w-0">
            <Suspense fallback={<div className="h-full w-[240px] rounded-lg bg-surface" />}>
              <Sidebar />
            </Suspense>
          </div>
          <NavResizer width={navWidth} onChange={setNavWidth} />
        </div>

        <main
          id="muscify-main"
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface"
        >

          <div
            id="muscify-scroll"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 md:px-6 focus:outline-none"
          >
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

/*
  The mobile chip row that used to live here is gone.

  It was measured at 390x844: eight destinations wrapped onto three lines before
  any content appeared, which on the library page consumed most of the fold.
  Replaced by the drawer in the top bar, which costs nothing until opened, fits
  every destination plus the listener's own playlists, and makes the phone layout
  the same navigation the desktop sidebar already offers.
*/
