"use client";

import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { useUi } from "@/store/ui-store";

/**
 * Bottom-right toast stack.
 *
 * Sits above the player bar so notifications never cover the transport
 * controls, and supports the undo action Spotify shows after destructive
 * actions like removing a song from a playlist.
 */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);

  if (!toasts.length) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-[110px] z-[90] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-3 rounded-md border border-line bg-elevated px-4 py-3 shadow-2xl"
        >
          <span className="shrink-0">
            {toast.kind === "success" ? (
              <CheckCircle2 size={18} className="text-spotify" />
            ) : toast.kind === "error" ? (
              <AlertTriangle size={18} className="text-red-400" />
            ) : (
              <Info size={18} className="text-sub" />
            )}
          </span>

          <p className="min-w-0 flex-1 truncate text-sm text-on">{toast.message}</p>

          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                dismiss(toast.id);
              }}
              className="shrink-0 text-xs font-bold tracking-wide text-spotify hover:underline"
            >
              {toast.action.label.toUpperCase()}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
            className="shrink-0 text-dim hover:text-on"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}