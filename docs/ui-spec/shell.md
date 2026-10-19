# Shell layout contract

Every number here was read off the rendered public web player at 1440×900,
dark scheme. Method and raw captures: [evidence.md](./evidence.md).

The point of this file is that the other agent does not have to re-derive the
geometry or guess at it. It is all measured.

---

## 1. The four regions

```
┌──────────────────────────────────────────────────────────────────────┐
│  TOP BAR                                    full-bleed   64px  #000 │  y 0
├────────────┬─────────────────────────────────────────────────────────┤
│            │                                                         │
│  SIDEBAR   │   CONTENT                    scroll-y: auto   #121212   │
│  331px     │   x = 347                                                │
│  #000      │   = 8 (gutter) + 331 (rail) + 8 (gutter)                │
│  r 8px     │                                                         │
│  z 4       │                                                         │
│  y 64      │                                                         │
├────────────┴─────────────────────────────────────────────────────────┤
│  PLAYER BAR                        when something is playing          │
└──────────────────────────────────────────────────────────────────────┘
```

| Region | Width | Height | y | Background | Notes |
|---|---|---|---|---|---|
| Top bar | 100% | **64px** | 0 | `#000000` | padding `8px`, full-bleed |
| Sidebar | **331px** | fills | 64 | `#000000` | radius `8px`, `z-index: 4` |
| Content | rest | fills | 64 | `#121212` | `overflow-y: auto` — the only scroller |
| Player bar | 100% | — | — | `#121212` | absent entirely when nothing plays |

**Measured detail that matters:**

- The content column starts at exactly **x = 347** = 8 + 331 + 8. The 8px
  gutter is on *both* sides of the rail; the sidebar's own `8px` left margin
  is included in that.
- The sidebar sits **below** the top bar (y = 64), not beside it. It does not
  run the full height of the viewport.
- `document.documentElement` scrollbar gutter measured **0** — the layout does
  not reserve a gutter; the content column scrolls internally instead.

## 2. Responsive behaviour

Measured at seven widths. Only two things change: the rail width, and the
shelf track size.

| Viewport | Sidebar | Content x | Content w | Shelf track |
|---|---|---|---|---|
| 1920 | 331px | 347 | 1525 | **195.5px** |
| 1600 | 331px | 347 | 1205 | **195.5px** |
| 1440 | 331px | 347 | 1045 | **195.5px** |
| 1280 | 331px | 347 | 885 | **177.72px** |
| 1100 | 331px | 347 | 705 | 177.72px |
| 900 | 331px | 347 | 505 | 177.72px |
| 768 | 320px | 336 | 416 | 177.72px |

- The rail is a **fixed 331px**, not fluid, from 900px up. Below 900 it drops
  to 320px.
- The shelf track steps at **1280 → 1440**. It is a breakpoint, not a
  continuous calculation. There are exactly two card sizes.
- Visible cards = `floor((content width − 28px) / (track + 24px))`.

**Below 900px this is not the layout.** At 320–393px the rail, the search field
and the top bar are all replaced — see [mobile.md](./mobile.md). Phone is a
different composition, not a narrower version of this one.

## 3. Top bar

| Element | Geometry |
|---|---|
| bar | full width, **64px** tall, `padding: 8px`, background `#000` |
| logo | circular, top-left |
| home button | icon, immediately right of logo |
| search field | **474 × 48**, `x: 144`, `y: 8` |
| right cluster | Premium · Support · Download · divider · Install App · Sign up · Log in |

**Search field** (all measured):

```
height      48px
width       474px
background  #1f1f1f
radius      500px
font        16px
padding     12px 96px 12px 48px      ← 48px left clears the search icon
role        combobox
accessible name  "What do you want to play?"   (a question, not the word "Search")
```

The accessible name being a *question* is deliberate upstream: it tells a
screen-reader user this is a suggestion surface, not a submit button. Use the
same phrasing.

## 4. Shelf (content rail) — the important one

This is the pattern that most often gets faked with `overflow-x: auto`. Upstream
it is a real ARIA grid, and it should be here too.

```html
<section aria-labelledby="shelf-trending">      <!-- role=region, named -->
  <header class="flex items-end justify-between">
    <h2 id="shelf-trending">Trending songs</h2> <!-- 24px / 700 / #fff -->
    <a href="/playlist/trending">Show all</a>    <!-- 16px / 700 / #b3b3b3 -->
  </header>
  <div role="grid" aria-labelledby="shelf-trending">
    <div role="row">
      <div role="gridcell">…</div>  <!-- ×20, virtualised -->
    </div>
  </div>
</section>
```

**Measured grid mechanics:**

```
display              grid
grid-auto-flow       column
grid-template-columns 20 tracks   ← fixed count, virtualised
padding-left         28px         ← aligns cards with the 8px gutter + 20px
track                177.72px  (≤1280)  /  195.5px  (≥1440)
```

**Card geometry — derived, and this is the one to check:**

- Measured artwork at 1440px: **171.5px square**.
- Measured track at 1440px: **195.5px**.
- 195.5 − 171.5 = **24px**, so the grid cell carries **12px of inline padding**
  and the visual gap between two cards is **24px**.

> ⚠️ This one value is *derived*, not directly observed — the page virtualises
> its cells and the rendered `gridcell` reported width 0. If you want it
> certain, render a shelf in muscify at 1440px and measure the artwork. The
> arithmetic is the only evidence; treat it as a strong default, not a fact.

**Card content:**

| Part | Value |
|---|---|
| artwork | square, `border-radius: 6px`, `object-fit: cover` |
| title | 16px / 400 / `#ffffff` |
| subtitle | 14px / 400 — colour needs verification (see components.md) |
| artist variant | artwork is **circular** (`50%`), subtitle reads "Artist" |

**Shelf header:** heading is `24px / 700 / #ffffff`; the "Show all" link sits
right-aligned on the same baseline.

**Vertical rhythm between shelves** measured 284–375px depending on shelf
height, i.e. it is content-driven, not a fixed margin. Do not hard-code a gap
between shelves — let the shelf's own height and a single `margin` do it.

## 5. Player bar

Not observable logged-out — the reference renders no player bar until
something is playing. What *is* established, from the accessibility tree:

```
complementary  "Now playing bar"
├── slider  "Change progress"
├── slider  "Change volume"
├── slider  "Resize main navigation"
└── buttons "Enable shuffle" · "Previous" · "Pause" · "Next" · "Mute"
             "Show Now Playing view"
```

Two things to copy that are easy to miss:

1. **"Show Now Playing view" is an explicitly named control.** muscify has the
   control but exposes it only as an unlabelled icon, so a non-mouse user
   cannot reach the full-screen player at all.
2. **"Resize main navigation" exists.** The rail is user-resizable. Lower
   priority — it is a desktop nicety and adds persisted layout state.

muscify already uses `complementary` + the name "Now playing bar". Keep it.

## 6. Structural contract (accessibility tree, measured)

```
role census   link:162  button:126  listitem:79  row:56  paragraph:56
              img:54  gridcell:54  heading:6  grid:6  list:5  region:5
              group:5  slider:3  navigation:2  separator:2  search:1
```

Landmarks, in document order:

| Role | Name |
|---|---|
| `search` | — (contains the combobox) |
| `navigation` | `Main` |
| `grid` | `Your Library` |
| `complementary` | `Now playing bar` |
| `region` ×5 | `Trending songs` · `Popular artists` · `Popular albums and singles` · `Popular radio` · `Featured Charts` |

Headings: exactly two `h1` (`Your Library`, `Home`) and four `h4` in the
footer. **Shelf headings are `h2`.** There are no `tab` roles at all — the
rail is the grid, not a tab list.

Five named regions is the single highest-value item in this document. A
`region` is only exposed to assistive tech when it has an accessible name, so
those five are real landmark navigation: a screen-reader user jumps shelf to
shelf instead of walking the tree. muscify's shelves currently render an `h2`
and a grid but no named region, so its Home page has no equivalent jump list.
That is a one-line fix with a disproportionate accessibility return.

## 7. Things that are *not* measured

Do not let these get invented later and presented as measured:

- The player bar's visual layout — nothing plays while logged out.
- Any hover state on the *card* — cells virtualise to width 0 and never
  receive the pointer. (Hover is a pointer concept anyway; see mobile.md §4
  for what replaces it.)
- Album, artist and playlist detail pages. The logged-out client does not
  render them without a session, and this capture deliberately used none.
- The full-screen "Now Playing" view.
- **Tablet.** 768px was attempted with an iPad descriptor and the site
  returned "Unsupported browser" — it refuses that user agent outright. iPad
  showed no rail and no tab bar because it showed *nothing*. That is not a
  measurement of a tablet layout.

Phone widths (320–393px) **are** measured — see [mobile.md](./mobile.md).

If another agent needs one of the above, it has to be captured, not recalled.
