"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useLibrary } from "@/store/library-store";
import { useUi } from "@/store/ui-store";

/**
 * Modal host — a single mounted surface that renders whichever dialog the
 * ui-store currently has open, so dialogs can be triggered from anywhere
 * (context menus, keyboard, toasts) without prop drilling.
 */
export function ModalHost() {
  const modal = useUi((s) => s.modal);
  const close = useUi((s) => s.closeModal);

  if (!modal) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {modal.kind === "create-playlist" ? <CreatePlaylistDialog /> : null}
      {modal.kind === "edit-playlist" ? <EditPlaylistDialog id={modal.playlistId} /> : null}
      {modal.kind === "confirm" ? <ConfirmDialog /> : null}
    </div>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="w-full max-w-md rounded-lg border border-line bg-elevated p-6 shadow-2xl"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 className="text-xl font-bold text-on">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1 text-dim transition hover:text-on"
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </div>
  );
}

function CreatePlaylistDialog() {
  const close = useUi((s) => s.closeModal);
  const toast = useUi((s) => s.toast);
  const createPlaylist = useLibrary((s) => s.createPlaylist);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const created = createPlaylist(trimmed, description.trim());
    if (created) toast(`Created ${created.name}`, "success");
    close();
  };

  return (
    <Dialog title="Create playlist" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide text-sub uppercase">
            Name
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My playlist"
            className="w-full rounded border border-line bg-base px-3 py-2 text-sm text-on placeholder:text-dim focus:border-spotify focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide text-sub uppercase">
            Description
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this for?"
            rows={3}
            className="w-full resize-none rounded border border-line bg-base px-3 py-2 text-sm text-on placeholder:text-dim focus:border-spotify focus:outline-none"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-sub transition hover:border-on hover:text-on"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-full bg-spotify px-5 py-2 text-sm font-semibold text-black transition hover:bg-spotify-dark disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function EditPlaylistDialog({ id }: { id: string }) {
  const close = useUi((s) => s.closeModal);
  const toast = useUi((s) => s.toast);
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id));
  const rename = useLibrary((s) => s.renamePlaylist);
  const remove = useLibrary((s) => s.deletePlaylist);

  const [name, setName] = useState(playlist?.name ?? "");
  const [description, setDescription] = useState(playlist?.description ?? "");

  if (!playlist) return null;

  return (
    <Dialog title="Edit details" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          rename(id, name, description);
          toast("Playlist updated", "success");
          close();
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide text-sub uppercase">
            Name
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-line bg-base px-3 py-2 text-sm text-on focus:border-spotify focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide text-sub uppercase">
            Description
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full resize-none rounded border border-line bg-base px-3 py-2 text-sm text-on focus:border-spotify focus:outline-none"
          />
        </label>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              remove(id);
              toast(`Deleted ${playlist.name}`, "success");
              close();
            }}
            className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-red-400 transition hover:border-red-400"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-sub transition hover:border-on hover:text-on"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-full bg-spotify px-5 py-2 text-sm font-semibold text-black transition hover:bg-spotify-dark disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function ConfirmDialog() {
  const modal = useUi((s) => s.modal);
  const close = useUi((s) => s.closeModal);
  const [busy, setBusy] = useState(false);

  if (modal?.kind !== "confirm") return null;
  const { title, body, confirmLabel, run } = modal;

  return (
    <Dialog title={title} onClose={close}>
      <p className="mb-6 text-sm text-sub">{body}</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={close}
          className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-sub transition hover:border-on hover:text-on"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            run();
            close();
          }}
          className="rounded-full bg-spotify px-5 py-2 text-sm font-semibold text-black transition hover:bg-spotify-dark disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}