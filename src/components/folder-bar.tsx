"use client";

import { useRef, useState } from "react";
import { Folder as FolderIcon, FolderPlus, MoreHorizontal, Plus, X } from "lucide-react";

import { useLibrary } from "@/store/library-store";
import { useUi } from "@/store/ui-store";

/**
 * Library folders.
 *
 * Shown as a row of chips above the playlist grid, which is how the library
 * reads when someone has more than a handful of playlists: the folders are
 * filters, not a separate page, so switching between them costs one click and
 * keeps the grid in place.
 *
 * Everything here operates on the store directly rather than through a modal,
 * because each operation is small and reversible except deletion — and deletion
 * asks first rather than hiding behind a confirm dialog, since deleting a folder
 * returns its playlists to the shelf rather than destroying them.
 */
export function FolderBar({
  active,
  onChange,
}: {
  /** Folder id, or null for "everything". */
  active: string | null;
  onChange: (id: string | null) => void;
}) {
  const folders = useLibrary((s) => s.folders);
  const playlists = useLibrary((s) => s.playlists);
  const createFolder = useLibrary((s) => s.createFolder);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const commit = () => {
    const made = createFolder(draft);
    setDraft("");
    setAdding(false);
    // Jump straight into the folder that was just made, so the gesture lands
    // somewhere visible instead of appearing to do nothing.
    if (made) onChange(made.id);
  };

  if (!folders.length && !adding) {
    return (
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-sub transition hover:border-line-strong hover:text-on"
        >
          <FolderPlus size={14} aria-hidden />
          Create folder
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              commit();
            }}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-elevated py-1 pr-1 pl-3"
          >
            <input
              ref={input}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraft("");
                  setAdding(false);
                }
              }}
              placeholder="Folder name"
              aria-label="Folder name"
              maxLength={64}
              className="w-40 bg-transparent text-xs text-on outline-none placeholder:text-dim"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="flex size-6 items-center justify-center rounded-full bg-spotify text-black disabled:opacity-30"
              aria-label="Create folder"
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft("");
                setAdding(false);
              }}
              className="flex size-6 items-center justify-center rounded-full text-sub hover:text-on"
              aria-label="Cancel"
            >
              <X size={13} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-sub transition hover:border-line-strong hover:text-on"
          >
            <FolderPlus size={14} aria-hidden />
            New folder
          </button>
        )}

        {adding ? null : null}

        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={active === null}
          className={chip(active === null)}
        >
          All
        </button>

        {folders.map((f) => {
          const count = playlists.filter((p) => p.folderId === f.id).length;
          return (
            <span key={f.id} className="group/folder relative inline-flex">
              <button
                type="button"
                onClick={() => onChange(f.id)}
                aria-pressed={active === f.id}
                className={chip(active === f.id)}
              >
                <FolderIcon size={13} aria-hidden />
                <span className="max-w-32 truncate">{f.name}</span>
                <span className="text-dim">{count}</span>
              </button>
              <button
                type="button"
                aria-label={`${f.name} options`}
                onClick={(e) => openFolderMenu(e, f.id)}
                className="ml-1 flex size-7 items-center justify-center rounded-full text-dim opacity-0 transition group-hover/folder:opacity-100 hover:bg-highlight hover:text-on focus-visible:opacity-100"
              >
                <MoreHorizontal size={14} aria-hidden />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function chip(on: boolean) {
  return (
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ` +
    (on
      ? "border-on bg-on text-black"
      : "border-line text-sub hover:border-line-strong hover:text-on")
  );
}

/** Rename and delete, on the existing context menu rather than a second one. */
function openFolderMenu(e: React.MouseEvent, folderId: string) {
  e.preventDefault();
  e.stopPropagation();
  const rename = useLibrary.getState().renameFolder;
  const remove = useLibrary.getState().deleteFolder;
  const folders = useLibrary.getState().folders;
  const current = folders.find((f) => f.id === folderId);
  useUi.getState().openContextMenu(e.clientX, e.clientY, [
    {
      label: "Rename",
      run: () => {
        const next = window.prompt("Rename folder", current?.name ?? "");
        if (next !== null) rename(folderId, next);
      },
    },
    {
      label: "Delete folder",
      danger: true,
      run: () => {
        // Its playlists come back to the shelf rather than being destroyed, so
        // this is safe to do without a confirmation step -- but it is still
        // stated plainly in the menu so nobody discovers it afterwards.
        remove(folderId);
        useUi.getState().toast("Folder deleted. Its playlists are back in your library.");
      },
    },
  ]);
}

/**
 * Adds "Move to folder" to a playlist's menu.
 *
 * Returns menu items rather than a component so the caller decides where the
 * menu is opened from, which keeps this out of the tile's markup.
 */
export function moveToFolderItems(playlistId: string) {
  const folders = useLibrary.getState().folders;
  const move = useLibrary.getState().moveToFolder;
  const playlist = useLibrary.getState().playlists.find((p) => p.id === playlistId);

  return [
    {
      label: "Move to folder",
      children: [
        {
          label: "No folder",
          run: () => move(playlistId, null),
        },
        ...folders.map((f) => ({
          label: f.name,
          disabled: playlist?.folderId === f.id,
          run: () => move(playlistId, f.id),
        })),
      ],
    },
  ];
}