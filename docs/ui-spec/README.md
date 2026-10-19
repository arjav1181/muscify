# UI spec — Spotify-derived, for muscify

A hand-off package. Another agent should be able to read this directory and
implement the UI without opening the reference site.

## **Look at [`evidence/reference-home-1440.png`](./evidence/reference-home-1440.png)
first.** It is the whole desktop layout in one image and it is worth more than
any table below it. The phone layout is
[`evidence/mobile-iphone-13.png`](./evidence/mobile-iphone-13.png).

Read in this order

| File | What it is |
|---|---|
| **[tokens.css](./tokens.css)** | Drop-in Tailwind 4 `@theme` block. Every colour, radius, type step and duration, labelled MEASURED or INFERRED. |
| **[shell.md](./shell.md)** | Desktop layout geometry: region sizes, the 331/64/8px shell, the shelf rail contract, the accessibility tree. |
| **[mobile.md](./mobile.md)** | Phone layout: 70px tab bar, 56px top bar, fixed 168px rail with scroll-snap. Separate composition, not a shrunk desktop. |
| **[components.md](./components.md)** | Tailwind classes + React skeletons per component, desktop and mobile, with the measurement behind each. |
| **[evidence.md](./evidence.md)** | How it was captured and how to re-capture it. |

## TL;DR for the implementing agent

muscify's **token layer is already correct** — this capture independently
confirmed all of it. Do not rewrite `globals.css` wholesale.

The actual gaps, in order of value per unit of effort:

1. **`ease-brand`** — the reference uses one curve everywhere:
   `cubic-bezier(0.3, 0, 0, 1)` at 150ms. Tailwind's stock `ease-out` is
   `cubic-bezier(0, 0, 0.2, 1)`, which is measurably different — less
   aggressive launch, shorter settle. This one change does more for the feel of
   the whole app than anything else here.
2. **Shelf → horizontal rail.** Currently a wrapping `grid-cols-*`. Upstream is
   `grid-auto-flow: column` with two fixed track sizes.
3. **Shell geometry** — fixed 331px rail, 64px top bar, 8px gutters.
4. **Phone layout.** muscify has **no mobile composition at all** — the shell
   is `grid-cols-[331px_1fr]` unconditionally. That is a 331px sidebar on a
   390px phone. See `mobile.md`.
5. **Name the "Show Now Playing view" control.** It exists but has no
   accessible name, so it is unreachable without a mouse.

## Ground rules

- **MEASURED ≠ INFERRED.** Every value in this directory is labelled. Do not
  promote an inferred value to a fact, and do not describe a remembered value
  as measured.
- **Where it was not captured, it says so.** The player bar's visual layout,
  mobile, and the album/artist/playlist pages were all out of reach of an
  anonymous session. They are listed in `shell.md` §7 precisely so nobody fills
  them in with a plausible guess.
- **Take the system, not the identity.** Layout, spacing, type scale, colour,
  motion and the accessibility contract are all fair game and are what makes
  this UI legible. The typeface (Circular), the wordmark, the logo and the icon
  set are licensed or trademarked and are **not** being taken. muscify ships
  its own font and its own marks. That line is already drawn in
  `docs/ux-grounding.md` and in the header comment of `globals.css`; this
  package does not cross it.
- **Green is a colour, not a brand.** `#1ed760` is measured and used as an
  accent. It is not anyone's logo.

## What this is not

This is **not** a clone and not a pixel copy. It is a measurement of one dark
music UI's structural and visual contract, expressed as Tailwind tokens and
component classes for a different product that happens to have the same
problem shape.

## Prior art in this repo

This package supersedes nothing and duplicates little:

- `docs/rea-findings.md` — the earlier REA pass. It captured the
  **accessibility tree only** and correctly recorded that the visual layer was
  still missing. This package fills that gap.
- `docs/ux-grounding.md` — Spotify's *published* design guidelines (artwork
  radius, the `#191414` fallback, truncation guidance). Those are cited claims
  from documentation. This package is *measured* observation. Where the two
  disagree, the disagreement is called out — see the artwork radius note in
  `tokens.css` §5.
- `SPOTIFY_DETAILED_SPEC_SHEET.html` — mostly describes a commercial platform
  (podcasts, audiobooks, video, Connect, social, billing). Per `MEMORY.md` §10,
  the in-scope parts are §16 audio processing, §17 offline, §11 library,
  §12 discovery and §22 error states. Nothing here overlaps that.
