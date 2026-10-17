"use client";

import { create } from "zustand";
import type { SearchTab, Track } from "@/lib/types";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
  /** Optional undo action, as Spotify shows after removing a song. */
  action?: { label: string; run: () => void };
}

export type ModalKind =
  | { kind: "create-playlist" }
  | { kind: "edit-playlist"; playlistId: string }
  | { kind: "add-to-playlist"; track: Track }
  | { kind: "confirm"; title: string; body: string; confirmLabel: string; run: () => void }
  | { kind: "equalizer" }
  | null;

interface UiState {
  toasts: Toast[];
  modal: ModalKind;
  queueOpen: boolean;
  /** Full-screen Now Playing overlay. */
  nowPlayingOpen: boolean;
  lyricsOpen: boolean;
  contextMenu: { x: number; y: number; items: ContextItem[] } | null;

  /** Search lives here so the header field and the results pane stay in sync
      without round-tripping through the URL on every keystroke. */
  query: string;
  searchTab: SearchTab;

  toast: (message: string, kind?: ToastKind, action?: Toast["action"]) => void;
  dismissToast: (id: string) => void;
  openModal: (modal: Exclude<ModalKind, null>) => void;
  closeModal: () => void;
  setQueueOpen: (open: boolean) => void;
  setNowPlayingOpen: (open: boolean) => void;
  setLyricsOpen: (open: boolean) => void;
  openContextMenu: (x: number, y: number, items: ContextItem[]) => void;
  closeContextMenu: () => void;
  setQuery: (query: string) => void;
  setSearchTab: (tab: SearchTab) => void;
}

export interface ContextItem {
  label: string;
  /** Opens a second column; when present `run` is not used. */
  children?: ContextItem[];
  danger?: boolean;
  disabled?: boolean;
  run?: () => void;
}

let toastSeq = 0;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  modal: null,
  queueOpen: false,
  nowPlayingOpen: false,
  lyricsOpen: false,
  contextMenu: null,

  query: "",
  searchTab: "all",

  toast: (message, kind = "info", action) => {
    toastSeq += 1;
    const id = `t${toastSeq}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind, action }] }));
    // Errors stay longer, and action toasts need room to be clicked.
    const life = kind === "error" ? 6000 : action ? 6000 : 3200;
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, life);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setQueueOpen: (queueOpen) => set({ queueOpen }),
  setNowPlayingOpen: (nowPlayingOpen) => set({ nowPlayingOpen }),
  setLyricsOpen: (lyricsOpen) => set({ lyricsOpen }),
  openContextMenu: (x, y, items) =>
    // Clamp so the menu never opens off-screen near an edge.
    set({ contextMenu: { x: Math.min(x, window.innerWidth - 260), y: Math.min(y, window.innerHeight - 320), items } }),
  closeContextMenu: () => set({ contextMenu: null }),
  setQuery: (query) => set({ query }),
  setSearchTab: (searchTab) => set({ searchTab }),
}));