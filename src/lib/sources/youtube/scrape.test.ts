import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectVideoRenderers,
  extractInitialData,
  parseDuration,
  toTracks,
} from "./scrape.ts";

/** Minimal shape of the fields the scraper reads. */
function renderer(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: "Artist" }] },
    thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hq.jpg`, width: 480 }] },
    ...extra,
  };
}

const HTML = `<!doctype html><html><body><script>
var ytInitialData = {"contents":{"results":[{"videoRenderer":{"videoId":"abcdefghijk","title":{"runs":[{"text":"Song & Dance"}]}}}]},"a":"b{c}d"};
var meta = 1;
</script></body></html>`;

test("extracts the ytInitialData object", () => {
  const data = extractInitialData(HTML) as Record<string, unknown>;
  assert.ok(data, "should parse");
  assert.equal(data.a, "b{c}d", "braces inside strings must not end the object early");
});

test("returns null when the marker is absent", () => {
  assert.equal(extractInitialData("<html>nothing here</html>"), null);
  assert.equal(extractInitialData(""), null);
});

test("returns null on malformed JSON rather than throwing", () => {
  assert.equal(extractInitialData('var ytInitialData = {"a": '), null);
});

test("finds video renderers at any depth", () => {
  const tree = {
    a: { b: [{ videoRenderer: renderer("aaaaaaaaaaa", "One") }] },
    c: { d: { e: { videoRenderer: renderer("bbbbbbbbbbb", "Two") } } },
  };
  const found = collectVideoRenderers(tree);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((v) => v.videoId), ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
});

test("survives arrays, nulls and scalars in the tree", () => {
  const tree = { a: [null, 1, "x", { videoRenderer: renderer("ccccccccccc", "Three") }] };
  assert.equal(collectVideoRenderers(tree).length, 1);
  assert.equal(collectVideoRenderers(null).length, 0);
  assert.equal(collectVideoRenderers(undefined).length, 0);
});

test("parses durations", () => {
  assert.equal(parseDuration("3:45"), 225);
  assert.equal(parseDuration("1:02:03"), 3723);
  assert.equal(parseDuration("59"), 59);
  assert.equal(parseDuration(undefined), undefined);
  assert.equal(parseDuration("live"), undefined);
  assert.equal(parseDuration("not:time"), undefined);
});

test("converts renderers into tracks", () => {
  const tracks = toTracks([renderer("abcdefghijk", "Kesariya")]);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]!.source, "youtube");
  assert.equal(tracks[0]!.id, "abcdefghijk");
  assert.equal(tracks[0]!.title, "Kesariya");
  assert.equal(tracks[0]!.artist, "Artist");
  assert.match(tracks[0]!.cover, /i\.ytimg\.com/);
});

test("takes the largest thumbnail offered", () => {
  const item = renderer("abcdefghijk", "X", {
    thumbnail: {
      thumbnails: [
        { url: "small.jpg", width: 120 },
        { url: "big.jpg", width: 1280 },
        { url: "mid.jpg", width: 480 },
      ],
    },
  });
  assert.equal(toTracks([item])[0]!.cover, "big.jpg");
});

test("drops ids that cannot be embedded", () => {
  const tracks = toTracks([
    renderer("abcdefghijk", "Normal"),
    { videoId: "short", title: { runs: [{ text: "Short" }] } },
    { videoId: "has spaces", title: { runs: [{ text: "Bad" }] } },
    { videoId: "aaaaaaaaaaa", title: { runs: [] } }, // no title
  ]);
  assert.equal(tracks.length, 1, "only the normal 11-char id with a title survives");
  assert.equal(tracks[0]!.id, "abcdefghijk");
});

test("drops duplicates", () => {
  const tracks = toTracks([
    renderer("abcdefghijk", "Same"),
    renderer("abcdefghijk", "Same again"),
  ]);
  assert.equal(tracks.length, 1);
});

test("reads the plain-text title fallback", () => {
  const item = {
    videoId: "abcdefghijk",
    title: { simpleText: "Plain Title" },
    ownerText: { runs: [{ text: "A" }] },
  };
  assert.equal(toTracks([item])[0]!.title, "Plain Title");
});

test("handles an empty result set without throwing", () => {
  assert.deepEqual(toTracks([]), []);
  assert.deepEqual(toTracks([{} as never]), []);
});