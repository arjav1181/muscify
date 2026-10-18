"use client";

import { ArrowDown, ArrowUp, ListMusic, X } from "lucide-react";
import { usePlayer } from "@/store/player-store";
import { TrackRow } from "@/components/track-row";

export function QueuePanel({ inline = false }: { inline?: boolean }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const clearQueue = usePlayer((s) => s.clearQueue);
  const jump = usePlayer((s) => s.jump);
  const remove = usePlayer((s) => s.remove);
  const reorder = usePlayer((s) => s.reorder);

  return (
    <section
      aria-label="Queue"
      className={
        inline
          ? "flex max-h-[60vh] w-full flex-col overflow-hidden rounded-lg border border-line bg-elevated"
          : "absolute right-0 bottom-full z-40 mb-2 flex max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-lg border border-line bg-elevated shadow-2xl"
      }
    >
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-on">
          <ListMusic size={16} /> Queue
          {queue.length ? <span className="text-xs font-normal text-dim">{queue.length}</span> : null}
        </h2>
        <button
          type="button"
          onClick={clearQueue}
          disabled={!queue.length}
          className="rounded-full p-1 text-dim transition-colors hover:text-on disabled:opacity-40"
          aria-label="Clear queue"
        >
          <X size={15} />
        </button>
      </header>

      {queue.length === 0 ? (
        <p className="px-4 pb-6 text-sm text-dim">Your queue is empty.</p>
      ) : (
        <div className="overflow-y-auto px-1 pb-2">
          {queue.map((track, i) => (
            <div key={`${track.source}:${track.id}:${i}`} className="group/q relative flex items-center">
              <div className="min-w-0 flex-1">
                <TrackRow
                  track={track}
                  index={i}
                  active={i === index}
                  onPlay={() => jump(i)}
                  onRemove={() => remove(i)}
                  showArtwork={false}
                />
              </div>

              {/*
                Reorder controls. Buttons rather than drag-and-drop: dragging a
                queue row needs a pointer-capture dance that breaks with
                scroll containers, and two buttons are reachable by keyboard and
                usable on a touch screen without any gesture support at all.
              */}
              <div className="flex shrink-0 flex-col opacity-0 transition-opacity group-hover/q:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => reorder(i, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move ${track.title} up`}
                  className="rounded p-1 text-dim transition hover:bg-white/10 hover:text-on disabled:opacity-25"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => reorder(i, i + 1)}
                  disabled={i === queue.length - 1}
                  aria-label={`Move ${track.title} down`}
                  className="rounded p-1 text-dim transition hover:bg-white/10 hover:text-on disabled:opacity-25"
                >
                  <ArrowDown size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}