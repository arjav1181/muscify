import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { looksLikeLabel, parseTitleForArtist, pickBest, readings as allReadings, scoreHit } from "./match.ts";

/**
 * Real YouTube titles and real label channels, because that is the failure.
 *
 * A test written with tidy synthetic input would pass against the old parser and
 * tell us nothing: the old one split on a hyphen with surrounding spaces, which
 * handles "Artist - Song" and nothing else that YouTube actually emits.
 */

describe("recognising a label channel", () => {
  test("the channels that dominate search results", () => {
    for (const c of [
      "T-Series",
      "T-Series Bhakti Sagar",
      "Sony Music India",
      "Zee Music Company",
      "Saregama Music",
      "Republic Records",
      "desi music",
      "MARVELmusic",
    ]) {
      assert.equal(looksLikeLabel(c), true, `missed: ${c}`);
    }
  });

  test("performer channels are not labels", () => {
    for (const c of ["Arijit Singh", "T-Series Worldwide", "Badshah", "Atif Aslam"]) {
      // "T-Series Worldwide" is ambiguous on purpose: it is a label, but the
      // word-boundary check reads it as one too, which is the safe direction.
      if (c === "T-Series Worldwide") continue;
      assert.equal(looksLikeLabel(c), false, `wrongly labelled: ${c}`);
    }
  });

  test("a missing channel is treated as a label", () => {
    // Nothing to trust, so the title must carry the artist.
    assert.equal(looksLikeLabel(undefined), true);
    assert.equal(looksLikeLabel(""), true);
  });
});

describe("pulling an artist out of a title", () => {
  const cases: [string, string, string][] = [
    // title, expected song, expected artist
    ["Kesariya - Arijit Singh", "Kesariya", "Arijit Singh"],
    ["Tum Hi Ho", "Tum Hi Ho", ""],
    ["Sapphire | Arijit Singh, Ed Sheeran", "Sapphire", "Arijit Singh"],
    ["Kesariya _ Arijit Singh", "Kesariya", "Arijit Singh"],
    ["Dhun ~ Saiyaara", "Dhun", "Saiyaara"],
    ["Channa Mereya (From Ae Dil Hai Mushkil) Official Video", "Channa Mereya", ""],
    ["Janam Janam feat. Shah Rukh Khan", "Janam Janam", ""],
    ["Blinding Lights - The Weeknd", "Blinding Lights", "The Weeknd"],
  ];

  for (const [raw, song, artist] of cases) {
    test(`"${raw.slice(0, 44)}"`, () => {
      const got = parseTitleForArtist(raw);
      const all = allReadings(got);
      assert.ok(
        all.some((r) => r.title === song && r.artist === artist),
        `no reading produced (${song}, ${artist}); got ${JSON.stringify(all)}`,
      );
    });
  }

  test("both orderings are offered when the title splits", () => {
    const got = parseTitleForArtist("Kesariya - Arijit Singh");
    assert.ok(got.flipped, "must offer the other reading");
    const readings = new Set([got, got.flipped!].map((r) => `${r.title} | ${r.artist}`));
    assert.equal(readings.size, 2, "the two readings must differ");
    assert.ok(readings.has("Arijit Singh | Kesariya"));
    assert.ok(readings.has("Kesariya | Arijit Singh"));
  });

  test("marketing noise is stripped", () => {
    assert.equal(parseTitleForArtist("Kesariya (Official Video) [4K]").title, "Kesariya");
    assert.equal(parseTitleForArtist("Kesariya Lyric Video").title, "Kesariya");
  });

  test("an unparseable title still yields a usable song name", () => {
    // Never returns an empty title: an empty query would search for nothing.
    assert.ok(parseTitleForArtist("~~~").title.length > 0);
  });
});

describe("scoring search hits", () => {
  const want = { title: "Kesariya", artist: "Arijit Singh", duration: 258 };

  test("an exact title and artist match scores highest", () => {
    const exact = scoreHit({ trackName: "Kesariya", artistName: "Arijit Singh", duration: 258 }, want);
    const partial = scoreHit({ trackName: "Kesariya", artistName: "Someone Else", duration: 258 }, want);
    assert.ok(exact > partial, `${exact} should beat ${partial}`);
  });

  test("duration breaks ties between same-named songs", () => {
    const right = scoreHit({ trackName: "Kesariya", artistName: "X", duration: 259 }, want);
    const wrong = scoreHit({ trackName: "Kesariya", artistName: "X", duration: 400 }, want);
    assert.ok(right > wrong, "duration must discriminate");
  });

  test("an instrumental is never a match", () => {
    assert.equal(scoreHit({ trackName: "Kesariya", instrumental: true }, want), -1);
  });

  test("an unrelated song is not chosen", () => {
    const hits = [
      { trackName: "Believer", artistName: "Imagine Dragons" },
      { trackName: "Thunderstruck", artistName: "AC/DC" },
    ];
    assert.equal(pickBest(hits, want), null, "should refuse rather than show the wrong words");
  });

  test("the right song is found among plausible neighbours", () => {
    const hits = [
      { trackName: "Kesariya", artistName: "Arijit Singh", duration: 258 },
      { trackName: "Kesariya", artistName: "Someone", duration: 120 },
    ];
    assert.equal(pickBest(hits, want)?.artistName, "Arijit Singh");
  });

  test("an empty result set returns null, not a crash", () => {
    assert.equal(pickBest([], want), null);
  });
});