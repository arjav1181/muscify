"use client";

import { BarChart3, Compass, Heart, Home, Library as LibraryIcon, ListMusic, Plus, Radio as RadioIcon, Search, Settings, Sparkles, Timer } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { artFallback } from "@/lib/art";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Made for you", icon: Sparkles },
  { href: "/search", label: "Search", icon: Search },
  { href: "/library", label: "Your Library", icon: LibraryIcon },
  { href: "/radio", label: "Radio", icon: RadioIcon },
  { href: "/stats", label: "Listening stats", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const playlists = useLibrary((s) => s.playlists);
  const liked = useLibrary((s) => s.liked);
  const ready = useLibrary((s) => s.ready);
  const openModal = useUi((s) => s.openModal);

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-full shrink-0 flex-col overflow-y-auto md:w-[240px]"
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <Link href="/" className="flex min-h-11 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-spotify text-black">
            <Compass size={18} strokeWidth={2.5} />
          </span>
          <span className="text-lg font-bold tracking-tight text-on">muscify</span>
        </Link>
        <span className="ml-auto hidden md:block">
          <SleepTimerChip />
        </span>
      </div>

      <ul className="space-y-1 px-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${
                  active ? "bg-highlight text-on" : "text-sub hover:text-on"
                }`}
              >
                <Icon size={20} fill={active ? "currentColor" : "none"} />
                <span className="hidden md:inline">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <hr className="mx-3 my-4 border-line" />

      {/* Liked songs, pinned above user playlists as on Spotify. */}
      <Link
        href="/liked"
        className={`mx-1 flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-highlight ${
          pathname === "/liked" ? "bg-highlight" : ""
        }`}
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded"
          style={{ background: "linear-gradient(135deg,#450af5,#c4efd9)" }}
        >
          <Heart size={18} fill="white" className="text-white" />
        </span>
        <span className="hidden min-w-0 md:block">
          <span className="block truncate text-sm font-semibold text-on">Liked Songs</span>
          <span className="block text-xs text-sub">
            {ready ? `${liked.length} ${liked.length === 1 ? "song" : "songs"}` : "—"}
          </span>
        </span>
      </Link>

      <div className="mt-4 px-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wide text-dim uppercase">
            Your playlists
          </h2>
          <button
            type="button"
            onClick={() => openModal({ kind: "create-playlist" })}
            aria-label="Create playlist"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-dim transition hover:text-on"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      <ul className="mt-1 space-y-0.5 px-1">
        {playlists.map((p) => (
          <li key={p.id}>
            <Link
              href={`/playlist/${p.id}`}
              className={`flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-highlight ${
                pathname === `/playlist/${p.id}` ? "bg-highlight" : ""
              }`}
            >
              <PlaylistThumb playlistId={p.id} name={p.name} />
              <span className="hidden min-w-0 md:block">
                <span className="block truncate text-sm font-medium text-on">{p.name}</span>
                <span className="block truncate text-xs text-sub">
                  {p.items.length} {p.items.length === 1 ? "song" : "songs"}
                </span>
              </span>
            </Link>
          </li>
        ))}
        {!playlists.length && ready ? (
          <li className="px-3 py-2 text-xs text-dim">
            No playlists yet — create one to get started.
          </li>
        ) : null}
      </ul>

      <div className="mt-auto hidden px-3 py-4 md:block">
        <ShortcutHints />
      </div>
    </nav>
  );
}

function PlaylistThumb({ playlistId, name }: { playlistId: string; name: string }) {
  const coverKey = useLibrary((s) => s.playlists.find((p) => p.id === playlistId)?.coverKey);
  const cover = useLibrary((s) => (coverKey ? s.catalog[coverKey]?.track.cover : undefined));

  return (
    <span
      className="h-10 w-10 shrink-0 overflow-hidden rounded"
      style={cover ? undefined : { background: artFallback({ id: name, title: name }) }}
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <ListMusic size={14} className="text-muted" />
        </span>
      )}
    </span>
  );
}

function SleepTimerChip() {
  const remaining = usePlayer((s) => s.sleepTimerRemaining);
  if (!remaining) return null;

  return (
    <span className="flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[10px] text-sub">
      <Timer size={12} /> {remaining}m
    </span>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← →", "Seek 5s"],
  ["Shift + ← →", "Prev / next"],
  ["↑ ↓", "Volume"],
  ["M", "Mute"],
  ["S", "Shuffle"],
  ["R", "Repeat"],
  ["L", "Lyrics"],
  ["1–9", "Jump in queue"],
  ["/", "Focus search"],
];

function ShortcutHints() {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs text-dim hover:text-sub">
        Keyboard shortcuts
      </summary>
      <dl className="mt-2 space-y-1 text-[11px] text-dim">
        {SHORTCUTS.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-3">
            <dt className="font-mono text-sub">{key}</dt>
            <dd className="text-right">{label}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}