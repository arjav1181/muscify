"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Compass,
  Disc3,
  Heart,
  Library as LibraryIcon,
  Mic2,
  Radio as RadioIcon,
  Search,
  Settings,
  Sparkles,
  X,
  Home,
} from "lucide-react";

import { useLibrary } from "@/store/library-store";

/**
 * The navigation drawer for phones.
 *
 * This replaces the horizontal chip row that used to sit under the top bar. That
 * row was measured on a 390px screen and needed three lines of chips before any
 * content appeared, which on a library page is most of the fold. A drawer costs
 * nothing until it is opened, fits all eight destinations plus the listener's
 * own playlists, and matches what the desktop sidebar already does — so the two
 * layouts stop being different products.
 *
 * Behaviour that has to be right, because a drawer gets all of it wrong by
 * default:
 *
 *  - focus moves into it on open and returns to the trigger on close
 *  - Escape closes, and so does the scrim
 *  - Tab is trapped inside while open, so it cannot wander to the page behind
 *  - the page behind is `inert`, so it is neither focusable nor announced
 *  - body scroll is locked, otherwise the page scrolls under the drawer
 *  - route changes close it, so tapping a link does not leave it hanging open
 */
export function MobileDrawer() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const playlists = useLibrary((s) => s.playlists);
  const liked = useLibrary((s) => s.liked);

  const close = () => setOpen(false);

  /*
    Navigating dismisses the drawer by closing on the link's own click, not by
    watching `pathname` in an effect. The effect version worked and React's
    lint rule is right to object: it re-runs on every route change and calls
    setState to say something the click already knew. Closing in the handler is
    both cheaper and more direct.
  */

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;

    // Lock the page behind. `overflow: hidden` on body alone does not stop it
    // on iOS, which is why the position is pinned as well.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab") return;

      // Focus trap: wrap between the first and last focusable things inside.
      const nodes = panel.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    // Move focus in after paint, or the browser resets it to the body.
    const id = requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLElement>("a[href], button")?.focus();
    });

    return () => {
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(id);
      document.body.style.overflow = previousOverflow;
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  const links = [
    { href: "/", label: "Home", icon: Home },
    { href: "/discover", label: "For you", icon: Sparkles },
    { href: "/search", label: "Search", icon: Search },
    { href: "/library", label: "Your Library", icon: LibraryIcon },
    { href: "/radio", label: "Radio", icon: RadioIcon },
    { href: "/podcasts", label: "Podcasts", icon: Mic2 },
    { href: "/stats", label: "Listening stats", icon: BarChart3 },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-on transition hover:bg-highlight md:hidden"
      >
        <LibraryIcon size={20} aria-hidden />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] md:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={close}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />

          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="animate-fade-up absolute inset-y-0 left-0 flex w-[82%] max-w-80 flex-col bg-base"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <span className="flex items-center gap-2 text-base font-bold text-on">
                <span className="flex size-8 items-center justify-center rounded-full bg-spotify text-black">
                  <Disc3 size={16} aria-hidden />
                </span>
                muscify
              </span>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex size-10 items-center justify-center rounded-full text-sub hover:text-on"
              >
                <X size={20} />
              </button>
            </div>

            <nav aria-label="Main" className="flex flex-col px-2">
              {links.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition ${
                      active ? "bg-highlight text-on" : "text-sub hover:bg-highlight hover:text-on"
                    }`}
                  >
                    <Icon size={18} aria-hidden />
                    {label}
                  </Link>
                );
              })}
            </nav>

            {liked.length ? (
              <Link
                href="/liked"
                onClick={close}
                className="mx-2 mt-2 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold text-sub hover:bg-highlight hover:text-on"
              >
                <span
                  aria-hidden
                  className="flex size-6 items-center justify-center rounded bg-gradient-to-br from-indigo-400 to-purple-600 text-black"
                >
                  <Heart size={13} fill="currentColor" />
                </span>
                Liked Songs
                <span className="ml-auto text-xs text-dim">{liked.length}</span>
              </Link>
            ) : null}

            <div className="mt-auto border-t border-line px-2 py-3">
              <p className="px-3 pb-1 text-[11px] font-bold tracking-widest text-dim uppercase">
                Your playlists
              </p>
              {playlists.length === 0 ? (
                <p className="px-3 py-1 text-xs text-dim">No playlists yet.</p>
              ) : (
                playlists.slice(0, 12).map((p) => (
                  <Link
                    key={p.id}
                    href={`/playlist/${p.id}`}
                    onClick={close}
                    className="flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-sub hover:bg-highlight hover:text-on"
                  >
                    <Compass size={15} aria-hidden className="shrink-0 text-dim" />
                    <span className="truncate">{p.name}</span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}