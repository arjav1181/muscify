# muscify

A music player for **YouTube, Deezer, SomaFM radio and SoundCloud links**, rebuilt from the
JARVIS dashboard's `play_music` action into a Next.js 16 / React 19 app with a
Spotify-shaped interface.

```bash
cd muscify
cp .env.local.example .env.local   # optional — add YOUTUBE_API_KEY
npm install
npm run dev
```

Open <http://localhost:3000>. Without a key it still works — see
[Graceful degradation](#graceful-degradation).

---

## What's here

**Playback** — queue, shuffle, repeat (off/all/one), seek, volume + mute, sleep timer,
ducking, crossfade ramp, OS media-session integration (lock screen, media keys, watch),
and a tap-to-play fallback when the browser blocks autoplay.

**Sources** — four engines behind one interface:

| Source | Search | Playback engine | Notes |
|---|---|---|---|
| YouTube | Data API v3, `videoCategoryId=10` | IFrame Player API | Full play/pause/seek/volume/duration |
| Deezer | Public search + charts | Official embed widget | **Currently unplayable** — see [Known limits](#known-limits) |
| SomaFM | `channels.json`, 51 stations | Native `<audio>` | Only source with a real pause + volume |
| SoundCloud | oEmbed, pasted links | Official embed widget | Controls via `postMessage` |

**Library** — playlists (create/rename/delete/reorder/undo), Liked Songs, followed
artists, Recently Played with play counts, and a catalog derived from what you've
actually played. All persisted through a swappable `LibraryRepository`.

**Recommendations** ("Made for you", `/discover`) — three strategies, each backed by a
real source, each degrading independently:

| Strategy | Source | Needs a key? |
|---|---|---|
| Artist radio | Deezer's curated `/artist/{id}/radio` | No |
| Similar artists | Deezer's artist-similarity graph | No |
| Station-seeded | A radio station's genre/language tags → search | No |
| Mood shelves | Curated queries → search | YouTube only |

Personalised rows are built from your own listening history (the most-played
artists), so the shelves change as you listen.

**Discovery** — Home with curated shelves, search with seven filter tabs
(songs/videos/artists/albums/playlists/radio), radio directory with genre-aware station
matching, album and artist detail pages.

**Interface** — full Spotify route set, synced lyrics, right-click context menus,
keyboard shortcuts, toasts with undo, installable PWA, dark-only theme.

### Routes

```
/            Home (curated shelves)
/discover    Made for you (recommendations)
/search      Filterable search
/library     Playlists · Liked · Artists · Albums · Recently Played
/radio       SomaFM directory with station search
/liked       Liked Songs
/playlist/[id]
/album/[id]
/artist/[id]
```

---

## Architecture

```
src/
  app/                      routes + route handlers (server-side API proxy)
  components/
    player/                 bar, controls, progress, volume, queue, lyrics, engine host
    views/                  home, search, library, radio, album, artist, playlist, liked
    *.tsx                   shell, sidebar, top bar, context menu, toasts, modals
  lib/
    sources/                one module per provider + aggregator
    engines/                one playback engine per source, behind PlaybackEngine
    persistence/            LibraryRepository interface + localStorage implementation
  store/                    player, library, ui (Zustand)
  hooks/                    search, lyrics, resource, keyboard shortcuts
```

**State lives in three Zustand stores.** The player store owns the queue and transport;
the library store owns everything persisted; the UI store owns transient surface
(toasts, modals, context menus, search query). Components never talk to an engine
directly.

**Engines are imperative and isolated.** `PlayerHost` mounts one engine per source into
hidden containers and reconciles them against the store: a track change tears down every
other engine and loads the incoming one; engine events flow back as store writes.
Engines hold iframes and DOM nodes, which is exactly why they're kept *out* of the
stores.

**The persistence boundary is an interface.** `LibraryRepository` is the only thing that
knows storage is local. Swapping in REST or IndexedDB means writing one class — no
component changes.

**Station matching is ported from the original.** A radio-ish word ("jazz radio") opens
tag matching so a genre lands on a station; without one, only distinctive station
*names* match — so `play metal` correctly falls through to the track search instead of
matching "Metal Detector".

---

## Graceful degradation

The app is designed to stay useful when a source is unavailable. Failures are collected
per source rather than thrown, so one dead provider never blanks a page.

| Missing | What still works |
|---|---|
| `YOUTUBE_API_KEY` | All 213 radio stations, Deezer artist radio + similar artists, pasted links via oEmbed |
| Deezer (geo-blocked) | YouTube search + charts, all radio, pasted links |
| SomaFM API unreachable | 12 built-in fallback stations |
| Radio Browser unreachable | SomaFM directory still renders |

**Pasted links always work with no key at all**, because every provider's oEmbed
endpoint is unauthenticated. Search results, when a source fails, say so explicitly
rather than silently showing nothing.

---

## Known limits

These are real constraints, not oversights.

- **Crossfade is a volume ramp, not an overlap.** True crossfade needs two audio
  timelines running simultaneously, and the YouTube/Deezer/SoundCloud embeds expose no
  such control. What `fadeOutSeconds` does is ramp the master volume down over the last
  N seconds and back up on the next track — which removes the dead silence, most of what
  people want, without pretending to overlap.
- **Deezer is discoverable but not playable.** Its player widget URL now 302-redirects to
  a placeholder and returns `X-Frame-Options: SAMEORIGIN`, so it cannot be framed from a
  third-party origin at all. The API's 30-second `preview` field has also been removed.
  Deezer tracks still appear in search, albums and recommendations, and can be saved to
  playlists — but selecting one surfaces a notice with a one-click **"Search YouTube
  instead"** fallback rather than silent nothing. This is a change upstream of us: the
  original JARVIS player depended on that widget, and it has since rotted.
- **Deezer search and charts are geo-restricted** in some territories (empty `data` with a
  non-zero `total`). The app reports this explicitly instead of showing an empty shelf.
  Artist radio, similar artists and track lookups are served globally and do work.
- **No offline or background playback.** Caching provider streams breaks their terms.
- **Lyrics come from LRCLIB**, a free community database of transcriptions. Not every
  track has one, and they're community-submitted rather than licensed — fine for
  personal use, worth a licensing review before shipping publicly.
- **Spotify Connect / multi-device handoff** is a closed protocol and isn't implemented.
- **No premium tier.** Premium is a licence to stream commercial music; there's no flag
  that unlocks it. All features are ungated.
- **`npm audit` reports 5 high-severity findings** — all dev-only, transitive through
  `eslint-config-next → fast-glob → micromatch → braces`. The suggested `--force` fix
  *downgrades* `eslint-config-next` to v14, which isn't taken.

---

## Keyboard shortcuts

| Key | Action | | Key | Action |
|---|---|---|---|---|
| `Space` | Play / pause | | `S` | Toggle shuffle |
| `← →` | Seek 5s | | `R` | Cycle repeat |
| `Shift ← →` | Previous / next | | `L` | Toggle lyrics |
| `↑ ↓` | Volume | | `1`–`9` | Jump to queue item |
| `M` | Mute | | `/` | Focus search |
| `F` | Fullscreen | | `Esc` | Close topmost layer |

---

## API

All handlers are server-side, which is what keeps the YouTube key off the client and
avoids CORS on Deezer/SomaFM.

```
GET /api/music/browse?kind=trending|charts|radio
GET /api/music/search?q=&tab=all|songs|videos|artists|albums|playlists|radio
GET /api/music/stations?q=
GET /api/music/resolve?url=
GET /api/music/playlist?id=
GET /api/music/album?id=
GET /api/music/artist?id=&source=deezer|youtube
GET /api/music/recommend?mode=seeded|related|station|moods&...
```

Every response is `{ results, errors }` — `errors` is populated per-source and the UI
renders whatever did succeed.

---

## Deploy

### Vercel

Deploy-ready with no config — Vercel detects Next.js and runs `npm run build`.

```bash
npm i -g vercel
vercel                 # preview deployment
vercel --prod          # production
```

Then add the one optional environment variable:

```bash
vercel env add YOUTUBE_API_KEY production
```

**The app works without it** — Deezer, all 51 radio stations and pasted links are
unaffected. Only YouTube search and the YouTube music chart need a key.

The build is verified from a clean `git clone` + `npm ci` + `npm run build`,
which is exactly what Vercel runs.

### GitHub

```bash
git clone https://github.com/arjav1181/muscify.git
cd muscify
cp .env.local.example .env.local   # optional
npm install
npm run dev
```

---

## Scripts

```bash
npm run dev      # dev server
npm run build    # production build
npm run start    # serve the build
npm run lint     # eslint
```