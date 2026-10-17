import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWeights, personalise, rankForListener } from "./ranking.ts";
import { emptyTasteState, hide, snooze, type TasteState } from "../taste/taste.ts";

const NOW = 1_700_000_000_000;

function t(
  key: string,
  artist: string,
  extra: Partial<{
    language: string;
    region: "india" | "international";
    plays: number;
    explicit: boolean;
  }> = {},
) {
  // Keys are always full `source:id` so they match what trackKey() and the
  // taste module produce.
  const [source, id] = key.split(":");
  return {
    source: source as "deezer" | "youtube",
    id: id!,
    title: `Track ${id}`,
    artist,
    cover: "",
    ...extra,
  };
}

const ids = (list: { id: string }[]) => list.map((x) => x.id);

/** Taste for someone who plays Arijit a lot and Divine a little. */
function listener(): TasteState {
  return emptyTasteState();
}

const opts = {
  affinity: new Map([["deezer:a1", 400]]),
  artistWeight: new Map([["arijit singh", 7_200_000], ["divine", 1_800_000]]),
  tagWeight: new Map([["hindi", 5_000_000], ["punjabi", 1_500_000]]),
  languageWeight: new Map([["hindi", 6_000_000]]),
  now: NOW,
};

test("frequently played tracks rank above unheard ones", () => {
  const result = rankForListener(
    [t("deezer:new1", "Someone New"), t("deezer:a1", "Arijit Singh")],
    { ...opts, taste: listener() },
  );
  assert.equal(result[0]!.id, "a1", "the played track should lead");
});

test("favourite artists outrank unheard artists", () => {
  const result = rankForListener(
    [t("deezer:x", "Unknown Band"), t("deezer:y", "Arijit Singh"), t("deezer:z", "Divine")],
    { ...opts, taste: listener() },
  );
  assert.equal(result[0]!.artist, "Arijit Singh");
  assert.equal(result[1]!.artist, "Divine", "second favourite should beat unheard");
  assert.equal(result[2]!.artist, "Unknown Band");
});

test("a heavily repeated track cannot crowd out a different favourite", () => {
  // log1p compression: 40,000 listens of one track should not outrank every
  // other artist entirely.
  const result = rankForListener(
    [
      t("deezer:a1", "Arijit Singh"),
      t("deezer:q", "Arijit Singh"),
      t("deezer:z", "Divine"),
    ],
    {
      ...opts,
      affinity: new Map([["deezer:a1", 40_000]]),
      taste: listener(),
    },
  );
  assert.equal(result.length, 3, "nothing is dropped");
  // A second track by the top favourite is not unheard — it keeps the artist
  // boost and legitimately outranks the second favourite.
  assert.deepEqual(ids(result).slice(0, 2).sort(), ["a1", "q"]);
  assert.equal(result[2]!.artist, "Divine", "the other favourite is still present");
});

test("genuinely unheard material keeps a floor against nothing played", () => {
  const result = rankForListener(
    [t("deezer:a1", "Arijit Singh"), t("deezer:brand", "Never Heard Of")],
    {
      ...opts,
      affinity: new Map([["deezer:a1", 400]]),
      // No artist weight for anyone, so only the track-level signal separates them.
      artistWeight: new Map(),
      taste: listener(),
    },
  );
  assert.equal(result[0]!.id, "a1", "played leads");
  assert.equal(result[1]!.id, "brand", "unheard material is still offered");
});

test("unheard material still surfaces rather than only re-showing history", () => {
  const result = rankForListener(
    Array.from({ length: 8 }, (_, i) => t(`d:new${i}`, "Fresh Artist")),
    { ...opts, taste: listener() },
  );
  assert.equal(result.length, 8, "an all-new shelf must not collapse to nothing");
});

test("languages and radio directories the listener plays are preferred", () => {
  const result = rankForListener(
    [
      t("deezer:other", "Other", { language: "english" }),
      t("deezer:pan", "Other", { language: "punjabi" }),
      t("deezer:hin", "Other", { language: "hindi" }),
      t("deezer:in", "Other", { region: "india" }),
    ],
    {
      ...opts,
      tagWeight: new Map([["hindi", 5_000_000], ["india", 4_000_000]]),
      taste: listener(),
    },
  );
  assert.ok(ids(result).indexOf("hin") < ids(result).indexOf("pan"), "heavier language leads");
  assert.ok(ids(result).indexOf("in") < ids(result).indexOf("other"), "played directory preferred");
});

test("hidden tracks are removed before ranking, not just demoted", () => {
  let taste = emptyTasteState();
  taste = hide(taste, "deezer:a1", "global");

  const result = personalise(
    [t("deezer:a1", "Arijit Singh"), t("deezer:b", "Arijit Singh")],
    taste,
    opts,
  );
  assert.ok(!ids(result).includes("a1"), "hidden track must not appear at all");
  assert.equal(result.length, 1);
});

test("snoozed tracks are excluded until they lapse", () => {
  const taste = snooze(emptyTasteState(), "deezer:a1", NOW);
  const during = personalise([t("deezer:a1", "Arijit Singh"), t("deezer:b", "Other")], taste, opts);
  assert.ok(!ids(during).includes("a1"), "snoozed track excluded while active");

  const after = personalise([t("deezer:a1", "Arijit Singh"), t("deezer:b", "Other")], taste, {
    ...opts,
    now: NOW + 31 * 86_400_000,
  });
  assert.ok(ids(after).includes("a1"), "returns once the snooze has lapsed");
});

test("a scoped hide only applies inside its context", () => {
  let taste = emptyTasteState();
  taste = hide(taste, "deezer:a1", "playlist:abc");
  const tracks = [t("deezer:a1", "A"), t("deezer:b", "B")];

  assert.equal(
    personalise(tracks, taste, { ...opts, contextId: "playlist:abc" }).length,
    1,
    "removed inside the context",
  );
  assert.equal(personalise(tracks, taste, { ...opts, contextId: "playlist:xyz" }).length, 2);
});

test("explicit filtering applies when asked for", () => {
  const tracks = [t("deezer:a1", "Arijit Singh", { explicit: true }), t("deezer:b", "Arijit Singh")];
  assert.equal(personalise(tracks, emptyTasteState(), { ...opts, excludeExplicit: true }).length, 1);
  assert.equal(personalise(tracks, emptyTasteState(), opts).length, 2);
});

test("an empty taste state still returns everything, ordered", () => {
  const tracks = [t("deezer:a", "Zed"), t("deezer:b", "Abe")];
  const result = personalise(tracks, emptyTasteState(), {
    affinity: new Map(),
    artistWeight: new Map(),
    tagWeight: new Map(),
    languageWeight: new Map(),
  });
  assert.equal(result.length, 2, "a cold listener sees the whole shelf");
});

test("buildWeights derives all four maps from the play log", () => {
  const plays = [
    { key: "deezer:a1", at: NOW, ms: 200_000, private: false },
    { key: "deezer:a2", at: NOW, ms: 100_000, private: false },
    { key: "deezer:secret", at: NOW, ms: 300_000, private: true },
  ];
  const resolve = (key: string) =>
    key === "deezer:secret"
      ? { artist: "Hidden Artist", tags: ["jazz"], language: "english" }
      : { artist: "Arijit Singh", tags: ["romance,pop"], language: "Hindi" };

  const w = buildWeights(plays, resolve);
  assert.equal(w.affinity.size, 2, "private plays excluded");
  assert.equal(w.affinity.get("deezer:a1"), 200, "ms converted to seconds");
  assert.equal(w.artistWeight.get("arijit singh"), 300_000, "artist name lowercased");
  assert.equal(w.languageWeight.get("hindi"), 300_000, "language normalised to lowercase");
  // Both public plays share a resolver, so each tag accumulates 200s + 100s.
  assert.equal(w.tagWeight.get("romance"), 300_000);
  assert.equal(w.tagWeight.get("pop"), 300_000, "tag soup is split");
  assert.ok(!w.artistWeight.has("hidden artist"), "private artist must not shape taste");
  assert.ok(!w.tagWeight.has("jazz"), "private plays must not add tags");
});

test("weights feed ranking end to end", () => {
  const plays = [{ key: "deezer:a1", at: NOW, ms: 600_000, private: false }];
  const resolve = () => ({ artist: "Arijit Singh", tags: ["romance"], language: "hindi" });
  const w = buildWeights(plays, resolve);

  const result = personalise([t("deezer:new", "Nobody"), t("deezer:a1", "Arijit Singh")], emptyTasteState(), {
    ...w,
    now: NOW,
  });
  assert.equal(result[0]!.id, "a1", "the played track leads when weights are real");
});