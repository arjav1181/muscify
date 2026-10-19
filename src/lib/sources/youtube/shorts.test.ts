import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseDuration, rejectReason, withoutShorts } from "./shorts.ts";

/**
 * The cases that matter, with the real shapes YouTube returns.
 *
 * Every assertion is a pair: something that must be rejected *and* something
 * that must be kept. A filter tested only on its positives will happily throw
 * away every real song and still pass.
 */

const portrait = { maxres: { width: 1080, height: 1920 } };
const landscape = { maxres: { width: 1280, height: 720 } };
const square = { maxres: { width: 720, height: 720 } };

describe("duration parsing", () => {
  test("reads ISO 8601 durations", () => {
    assert.equal(parseDuration("PT45S"), 45);
    assert.equal(parseDuration("PT4M13S"), 253);
    assert.equal(parseDuration("PT1H2M3S"), 3723);
    assert.equal(parseDuration("PT3M"), 180);
  });

  test("returns undefined rather than guessing", () => {
    assert.equal(parseDuration(undefined), undefined);
    assert.equal(parseDuration(""), undefined);
    assert.equal(parseDuration("nonsense"), undefined);
    assert.equal(parseDuration("PT"), undefined);
  });
});

describe("Shorts are rejected", () => {
  test("an explicit #shorts in the title", () => {
    assert.equal(rejectReason({ title: "Pritam hits #shorts", duration: "PT30S" }), "short-marker");
  });

  test("an explicit #short in the description", () => {
    assert.equal(rejectReason({ title: "Trending", description: "listen now #short", duration: "PT30S" }), "short-marker");
  });

  test("a portrait thumbnail under a minute", () => {
    assert.equal(rejectReason({ title: "Song", duration: "PT45S", thumbnails: portrait }), "portrait");
  });

  test("a portrait thumbnail of unknown length", () => {
    assert.equal(rejectReason({ title: "Song", thumbnails: portrait }), "portrait");
  });

  test("a square thumbnail", () => {
    assert.equal(rejectReason({ title: "Song", duration: "PT20S", thumbnails: square }), "portrait");
  });

  test("a sub-30-second clip with no marker", () => {
    assert.equal(rejectReason({ title: "Best part", duration: "PT12S", thumbnails: landscape }), "too-short");
  });

  test("a live stream", () => {
    assert.equal(rejectReason({ title: "Live on now", duration: "PT2H" }), "live-stream");
  });

  test("Shorts-shaped items found by the batch helper", () => {
    const kept = withoutShorts([
      { title: "Real song", duration: "PT3M44S", thumbnails: landscape },
      { title: "Reel #shorts", duration: "PT20S", thumbnails: portrait },
    ]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].title, "Real song");
  });
});

describe("real songs are kept", () => {
  test("an ordinary 16:9 upload", () => {
    assert.equal(rejectReason({ title: "Pritam - Kesariya", duration: "PT4M13S", thumbnails: landscape }), null);
  });

  test("a long portrait upload -- a video filmed sideways", () => {
    // The case a naive "portrait means Short" filter destroys: vertical, but six
    // minutes long. That is a music video, not a reel.
    assert.equal(rejectReason({ title: "Official video", duration: "PT6M2S", thumbnails: portrait }), null);
  });

  test("a short but genuine recording", () => {
    // 45 seconds with a landscape thumbnail is a real short track or an intro,
    // not a Short. The too-short rule only fires under 30s.
    assert.equal(rejectReason({ title: "Live snippet", duration: "PT45S", thumbnails: landscape }), null);
  });

  test("a track with no duration and no thumbnails at all", () => {
    // Happens on a cold cache or a partial response. Must not throw, must not
    // discard everything.
    assert.equal(rejectReason({ title: "Something" }), null);
  });

  test("a long mix with #trending in the title", () => {
    // "trending" alone must not be enough -- a title like "Trending songs 2026"
    // is a real upload.
    assert.equal(rejectReason({ title: "Top Hits 2026 ~ Trending Songs", duration: "PT2H" }), null);
  });

  test("an empty object is kept rather than throwing", () => {
    assert.equal(rejectReason({}), null);
  });
});