"use client";

import { useEffect } from "react";
import { seekTo } from "@/lib/engines/control";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useUi } from "@/store/ui-store";

/** True when focus is in a field, so single-key shortcuts must stand down. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Spotify's desktop shortcut layer.
 *
 * Bound at the document level so shortcuts work from anywhere except form
 * fields. Every binding is a no-op against an empty queue so a stray keypress
 * can't surface an error.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const player = usePlayer.getState();
      const ui = useUi.getState();

      // Escape works even from a field, so dialogs are always escapable.
      if (e.key === "Escape") {
        if (ui.modal) ui.closeModal();
        else if (ui.contextMenu) ui.closeContextMenu();
        else if (ui.lyricsOpen) ui.setLyricsOpen(false);
        else if (ui.queueOpen) ui.setQueueOpen(false);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // Cmd/Ctrl+K focuses search; there's no separate palette surface.
        e.preventDefault();
        const input = document.getElementById("muscify-search");
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
        return;
      }

      if (isTyping(e.target)) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          player.toggle();
          break;

        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            player.next(false);
          } else if (player.duration > 0) {
            const target = Math.min(player.duration, player.position + 5);
            player.setTimeline(target, player.duration);
            seekTo(target / player.duration);
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            player.previous();
          } else if (player.duration > 0) {
            const target = Math.max(0, player.position - 5);
            player.setTimeline(target, player.duration);
            seekTo(target / player.duration);
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          player.setVolume(player.volume + 5);
          break;

        case "ArrowDown":
          e.preventDefault();
          player.setVolume(player.volume - 5);
          break;

        case "m":
          player.toggleMute();
          break;
        case "s":
          player.toggleShuffle();
          break;
        case "r":
          player.cycleRepeat();
          break;
        case "l":
          ui.setLyricsOpen(!ui.lyricsOpen);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "/":
          e.preventDefault();
          document.getElementById("muscify-search")?.focus();
          break;
        case "j":
          if (!e.shiftKey) player.next(false);
          break;
        case "k":
          if (!e.shiftKey) player.previous();
          break;
        default:
          // 1–9 jump to that position in the queue, as on Spotify desktop.
          if (/^[1-9]$/.test(e.key) && player.queue.length) {
            const target = Number(e.key) - 1;
            if (target < player.queue.length) player.jump(target);
          }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    void document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    void document.exitFullscreen?.().catch(() => {});
  }
}

/**
 * Tracks whether the library store has finished hydrating, so the UI can gate
 * persistence-dependent rendering without flashing an empty library.
 *
 * A mounted flag isn't needed here — the store's own `ready` flag only becomes
 * true after hydration runs in an effect, so `false` is correct during SSR.
 */
export function useLibraryReady(): boolean {
  return useLibrary((s) => s.ready);
}