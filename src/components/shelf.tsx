"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { AlertTriangle, Play } from "lucide-react";
import type { Track } from "@/lib/types";
import { TrackCard as DefaultTrackCard } from "@/components/track-card";

interface ShelfProps {
  title: string;
  subtitle?: string;
  tracks: Track[];
  loading?: boolean;
  errors?: string[];
  emptyLabel?: string;
  /** Rendered as a "Play all" button in the header. */
  onPlayAll?: () => void;
  /** Override the card renderer, e.g. to pass the full list for context. */
  renderCard?: (track: Track, index: number) => ReactNode;
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="mb-3 aspect-square rounded-card bg-elevated" />
          <div className="mb-2 h-3 w-4/5 rounded bg-highlight" />
          <div className="h-3 w-3/5 rounded bg-highlight" />
        </div>
      ))}
    </div>
  );
}

export function Shelf({
  title,
  subtitle,
  tracks,
  loading,
  errors,
  emptyLabel,
  onPlayAll,
  renderCard,
}: ShelfProps) {
  // Hide a shelf with nothing and no explanation, so one dead provider doesn't
  // leave a permanent empty section in the layout.
  if (!loading && tracks.length === 0 && !(errors && errors.length)) return null;

  /*
    Labelled by its own heading, which is what makes this a landmark rather than
    just a group.

    From the REA capture of open.spotify.com (docs/rea-findings.md §1.2): every
    content shelf there is a `region` with an accessible name — "Trending songs",
    "Popular artists", "Popular albums and singles", "Popular radio",
    "Featured Charts". A region only surfaces in a screen reader's landmark list
    when it is named, so those names are real navigation between shelves rather
    than decorative headings. muscify rendered the same headings and grids with
    no name, so its Home page had no landmark list at all.

    The id is derived from the title rather than generated, so a re-render
    cannot orphan the aria-labelledby reference.
  */
  const headingId = `shelf-${slug(title)}`;

  return (
    <section aria-labelledby={headingId} className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 id={headingId} className="text-xl font-bold tracking-tight text-on">
            {title}
          </h2>
          {subtitle ? <p className="mt-1 text-sm text-sub">{subtitle}</p> : null}
        </div>
        {onPlayAll && tracks.length ? (
          <button
            type="button"
            onClick={onPlayAll}
            title={`Play all in ${title}`}
            aria-label={`Play all in ${title}`}
            className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-spotify text-black shadow-lg transition hover:scale-105 sm:flex"
          >
            <Play size={16} fill="currentColor" className="translate-x-[1px]" />
          </button>
        ) : null}
      </div>

      {errors && errors.length ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-spotify/30 bg-spotify/10 px-3 py-2 text-xs text-spotify">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>{errors.join(" · ")}</span>
        </div>
      ) : null}

      {loading ? (
        <Skeleton />
      ) : tracks.length === 0 ? (
        <p className="py-4 text-sm text-dim">{emptyLabel ?? "Nothing here right now."}</p>
      ) : (
        /*
         * A real `grid`/`gridcell` structure with arrow-key traversal.
         *
         * A plain scroll container gives no keyboard route to the items past
         * the fold: the accessibility tree is a flat list with no row count,
         * and a keyboard user cannot tell there is more to the right. This is
         * the pattern captured from Spotify's own shelves in
         * docs/ux-grounding.md, and it was documented but never built until now.
         */
        <div
          role="grid"
          aria-label={title}
          aria-rowcount={1}
          onKeyDown={onGridKeyDown}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        >
          {tracks.map((track, i) => (
            <div
              key={`${track.source}:${track.id}:${i}`}
              role="gridcell"
              aria-colindex={i + 1}
              data-shelf-cell
              className="min-w-0"
            >
              {renderCard ? (
                renderCard(track, i)
              ) : (
                <DefaultTrackCard track={track} index={i} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Arrow-key traversal across a shelf.
 *
 * Left/Right move one cell, Up/Down move a whole row, Home/End jump to the
 * ends. The column count is measured from the live layout rather than
 * hardcoded, because this component renders two across on a phone and five on
 * a desktop, and the row stride has to follow the actual layout or Up jumps
 * into the wrong place.
 */
function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const { key } = event;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;

  const cells = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-shelf-cell]"));
  if (cells.length === 0) return;

  const active = document.activeElement as HTMLElement | null;
  const activeCell = active?.closest<HTMLElement>("[data-shelf-cell]");
  const from = activeCell ? cells.indexOf(activeCell) : -1;

  // Derive columns from where the first row of cells actually sits.
  const firstTop = cells[0]!.getBoundingClientRect().top;
  let columns = cells.findIndex((c) => Math.abs(c.getBoundingClientRect().top - firstTop) > 1);
  if (columns < 1) columns = cells.length;

  let next: number;
  switch (key) {
    case "ArrowLeft":
      next = from <= 0 ? cells.length - 1 : from - 1;
      break;
    case "ArrowRight":
      next = from < 0 || from === cells.length - 1 ? 0 : from + 1;
      break;
    case "ArrowUp":
      // Clamp to the same column, wrapping into the previous row's end.
      next = from - columns;
      if (next < 0) next = from < 0 ? 0 : (from % columns) - columns;
      if (next < 0) next += cells.length;
      break;
    case "ArrowDown":
      next = from < 0 ? 0 : from + columns;
      if (next >= cells.length) next = from < 0 ? 0 : from % columns;
      break;
    case "Home":
      next = 0;
      break;
    default:
      next = cells.length - 1;
  }

  if (next < 0 || next >= cells.length) return;
  event.preventDefault();

  // Focus the cell's own control rather than the wrapper, so Enter/Space work.
  const target = cells[next]!;
  const focusable = target.querySelector<HTMLElement>(
    "button, a[href], [tabindex]:not([tabindex='-1'])",
  );
  (focusable ?? target).focus();
}

/**
 * Turns a shelf title into a stable id fragment.
 *
 * Diacritics are folded so "90s throwbacks" and "Pop/Rock" cannot produce an id
 * that differs only by an accented character, and anything unexpected collapses
 * to a separator so the result is always a valid HTML id.
 */
function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
