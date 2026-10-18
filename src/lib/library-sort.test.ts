import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterPlaylists,
  sortArtists,
  sortHistory,
  sortPlaylists,
  type Sortable,
} from "./library-sort.ts";
import type { Playlist } from "./persistence/types.ts";

function playlist(over: Partial<Playlist> & { id: string }): Playlist {
  return {
    name: over.id,
    description: "",
    items: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

test("playlists sort by creation date, newest first", () => {
  const list = [
    playlist({ id: "a", createdAt: 100 }),
    playlist({ id: "b", createdAt: 300 }),
    playlist({ id: "c", createdAt: 200 }),
  ];
  assert.deepEqual(sortPlaylists(list, "recently-added").map((p) => p.id), ["b", "c", "a"]);
});

test("playlists sort alphabetically, case- and number-insensitively", () => {
  const list = [
    playlist({ id: "a", name: "banana" }),
    playlist({ id: "b", name: "Apple 2" }),
    playlist({ id: "c", name: "Apple 10" }),
  ];
  assert.deepEqual(sortPlaylists(list, "alphabetical").map((p) => p.id), ["b", "c", "a"]);
});

test("playlists sort by last update", () => {
  const list = [
    playlist({ id: "a", updatedAt: 100 }),
    playlist({ id: "b", updatedAt: 900 }),
  ];
  assert.deepEqual(sortPlaylists(list, "creator").map((p) => p.id), ["b", "a"]);
});

test("sorting is stable for equal entries", () => {
  const list = [
    playlist({ id: "z", createdAt: 100 }),
    playlist({ id: "a", createdAt: 100 }),
    playlist({ id: "m", createdAt: 100 }),
  ];
  // Without a tiebreak the order would depend on input order and could shuffle
  // between renders.
  assert.deepEqual(sortPlaylists(list, "recently-added").map((p) => p.id), ["a", "m", "z"]);
});

test("sorting does not mutate the input", () => {
  const list = [playlist({ id: "a", createdAt: 1 }), playlist({ id: "b", createdAt: 2 })];
  const before = list.map((p) => p.id);
  sortPlaylists(list, "recently-added");
  assert.deepEqual(list.map((p) => p.id), before);
});

const hist = (over: Partial<Sortable> & { id: string }): Sortable => ({
  label: over.id,
  addedAt: 100,
  ...over,
});

test("history sorts by most recent play", () => {
  const list = [
    hist({ id: "a", lastPlayedAt: 100 }),
    hist({ id: "b", lastPlayedAt: 300 }),
  ];
  assert.deepEqual(sortHistory(list, "recent").map((h) => h.id), ["b", "a"]);
});

test("history sorts by play count", () => {
  const list = [
    hist({ id: "a", plays: 2, lastPlayedAt: 900 }),
    hist({ id: "b", plays: 10, lastPlayedAt: 100 }),
  ];
  assert.deepEqual(sortHistory(list, "most-played").map((h) => h.id), ["b", "a"]);
});

test("history falls back to addedAt when never played", () => {
  const list = [hist({ id: "a", addedAt: 10 }), hist({ id: "b", addedAt: 20 })];
  assert.deepEqual(sortHistory(list, "recent").map((h) => h.id), ["b", "a"]);
});

test("history ties break alphabetically, not randomly", () => {
  const list = [hist({ id: "z", label: "Zed" }), hist({ id: "a", label: "Abe" })];
  assert.deepEqual(sortHistory(list, "recent").map((h) => h.label), ["Abe", "Zed"]);
});

test("artists rank by plays then name", () => {
  const list = [
    hist({ id: "a", label: "Zed", plays: 5 }),
    hist({ id: "b", label: "Abe", plays: 5 }),
    hist({ id: "c", label: "Mid", plays: 9 }),
  ];
  assert.deepEqual(sortArtists(list).map((a) => a.label), ["Mid", "Abe", "Zed"]);
});

test("playlist filter matches name and description", () => {
  const list = [
    playlist({ id: "a", name: "Workout", description: "gym" }),
    playlist({ id: "b", name: "Chill", description: "study and calm" }),
    playlist({ id: "c", name: "Party", description: "dance" }),
  ];
  assert.deepEqual(filterPlaylists(list, "gym").map((p) => p.id), ["a"]);
  assert.deepEqual(filterPlaylists(list, "calm").map((p) => p.id), ["b"]);
  assert.equal(filterPlaylists(list, "").length, 3, "empty query returns everything");
  assert.equal(filterPlaylists(list, "   ").length, 3, "whitespace is not a query");
  assert.equal(filterPlaylists(list, "zzz").length, 0);
});

test("playlist filter is case-insensitive", () => {
  const list = [playlist({ id: "a", name: "Workout" })];
  assert.equal(filterPlaylists(list, "WORKOUT").length, 1);
});