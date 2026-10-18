# Component specs

Tailwind classes for each part of the UI, with the measurement that justifies
each one. Sources: [tokens.css](./tokens.css), [shell.md](./shell.md).

Read the **Already matches / Change** line at the top of each section first —
most of muscify's token layer is already correct and independently confirmed by
this capture. Do not rewrite what is right.

---

## 0. TL;DR — what actually needs doing

| Area | State |
|---|---|
| Colour tokens | ✅ already correct — **verified against a fresh capture** |
| Radii | ✅ already correct (`rounded-card` = 6px) |
| Type ramp | ✅ already correct |
| Easing curve | ❌ **missing** — this is the single biggest perceptual gap |
| Shelf = horizontal rail | ❌ currently a wrapping `grid-cols-*` |
| Shell geometry (331 / 64 / 8px) | ❌ not specified |
| "Show Now Playing view" name | ❌ present but unlabelled |

---

## 1. Easing — do this first

Cheapest change in the document, largest perceptual difference.

The reference uses **one** curve everywhere:

```
transition: background-color, transform 150ms cubic-bezier(0.3, 0, 0, 1);
```

Tailwind's built-in `ease-out` is `cubic-bezier(0, 0, 0.2, 1)` — visibly
different: less aggressive launch, shorter settle. Substituting it is why a
dark UI built on stock Tailwind feels flat next to the reference.

`tokens.css` defines `--ease-brand`, which makes `ease-brand` a real utility.

```html
<!-- everywhere an element responds to a pointer -->
<div class="transition-[background-color,transform] duration-fast ease-brand">
```

**Rule:** every `transition-*` on an interactive element gets `ease-brand`.
Animation that opens with an overshoot or a bounce does not belong in this UI.

---

## 2. Top bar

**Change:** adopt the measured geometry. Current `--nav-height: 4rem` already
equals the measured 64px, so the only real work is the 8px gutter and the
black background split.

```html
<header class="flex h-topbar items-center gap-2 bg-base p-2">
  <a href="/" class="grid size-8 place-items-center rounded-full" aria-label="muscify home">
    <Logo class="size-8" />
  </a>

  <a href="/" class="grid size-8 place-items-center rounded-full text-sub
                    transition-colors duration-fast ease-brand
                    hover:bg-highlight hover:text-on" aria-label="Home">
    <Home class="size-6" />
  </a>

  <!-- 474 x 48 pill. NOTE the 48px left padding clears the icon. -->
  <div class="relative ml-2 flex-1 max-w-[474px]">
    <Search class="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-sub" />
    <input
      type="search"
      role="combobox"
      aria-label="What do you want to play?"
      placeholder="What do you want to play?"
      class="h-12 w-full rounded-field bg-elevated pl-12 pr-24 text-read text-on
             outline-none transition-colors duration-fast ease-brand
             placeholder:text-sub focus:ring-1 focus:ring-line-inset"
    />
  </div>

  <nav class="ml-auto flex items-center gap-6" aria-label="Account">
    <a class="text-read font-bold text-sub transition-colors duration-fast
              ease-brand hover:text-on">Premium</a>
    <a class="text-read font-bold text-sub transition-colors duration-fast
              ease-brand hover:text-on">Support</a>
    <a class="text-read font-bold text-sub transition-colors duration-fast
              ease-brand hover:text-on">Download</a>
    <span class="h-6 w-px bg-line-strong" aria-hidden />
    <a class="text-label font-bold text-sub hover:text-on">Sign up</a>
    <a class="rounded-pill bg-on px-6 py-3 text-label font-bold text-base
              transition-transform duration-fast ease-brand hover:scale-[1.04]">
      Log in
    </a>
  </nav>
</header>
```

The accessible name on the search field is **a question, not the word
"Search"**. That is deliberate upstream — it tells a screen-reader user the
field is a suggestion surface, not a submit button. Keep the phrasing.

---

## 3. Sidebar

**Change:** the rail is a fixed `331px` with an `8px` gutter, black, radius
`8px`, sitting *below* the top bar — not a full-height column.

```html
<div class="grid grid-cols-[331px_1fr] gap-2 p-2">
  <nav aria-label="Main"
       class="sticky top-topbar z-4 flex max-h-[calc(100dvh-var(--topbar-height)-1rem)]
              flex-col gap-2 rounded-panel bg-base p-3">
    <div class="flex items-center justify-between px-2">
      <h1 class="text-read font-bold text-sub">Your Library</h1>
      <button class="grid size-8 place-items-center rounded-full bg-elevated
                     text-on transition-transform duration-fast ease-brand
                     hover:scale-105" aria-label="Create playlist">
        <Plus class="size-5" />
      </button>
    </div>

    <!-- filler cards -->
    <div class="rounded-control bg-elevated p-4">
      <p class="text-label text-on">Create your first playlist</p>
      <p class="mt-1 text-label text-sub">It&apos;s easy, we&apos;ll help you</p>
      <button class="mt-4 rounded-pill bg-on px-6 py-3 text-label font-bold text-base
                     transition-transform duration-fast ease-brand hover:scale-1.04">
        Create playlist
      </button>
    </div>

    <div role="grid" aria-label="Your Library"
         class="mt-2 flex-1 overflow-y-auto">…</div>

    <footer class="mt-auto flex flex-wrap gap-x-4 gap-y-2 px-2 pt-6">
      <a class="text-micro text-sub hover:text-on">Legal</a>
      <a class="text-micro text-sub hover:text-on">Privacy</a>
      <a class="text-micro text-sub hover:text-on">Accessibility</a>
    </footer>
  </nav>

  <main id="main-view" class="rounded-panel bg-surface">{children}</main>
</div>
```

Notes that are measured rather than guessed:

- `<main>` carries `id="main-view"` — the skip link targets `#main-view`.
- Footer links are **12px**, not 14px. That is the only 12px text on the page.
- The two filler cards are `#1f1f1f`, radius `4px`.

---

## 4. Shelf — the rail

**This is the main change.** muscify currently renders a wrapping grid:

```tsx
// current — src/components/shelf.tsx
<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
```

The reference is a **horizontal rail** with exactly two card sizes and a fixed
track. It scrolls sideways; it does not reflow into fewer columns.

```tsx
/**
 * Horizontal content rail.
 *
 * Mirrors the measured shelf on the reference player: display:grid,
 * grid-auto-flow:column, padding-left 28px, and exactly two track widths —
 * 177.72px at <=1280 and 195.5px at >=1440. Cards are virtualised upstream;
 * muscify should render what fits and let the rail scroll.
 */
export function Rail({ title, id, children }: {
  title: string; id: string; children: ReactNode;
}) {
  return (
    // `aria-labelledby` is what turns this into a named landmark. Already done
    // in shelf.tsx — keep it.
    <section aria-labelledby={id} className="pt-6">
      <header className="flex items-end justify-between px-shell pl-[var(--shell-pad)]">
        <h2 id={id} className="text-title font-bold text-on">{title}</h2>
        <a href={`/browse/${id}`}
           className="text-read font-bold text-sub transition-colors
                      duration-fast ease-brand hover:text-on">
          Show all
        </a>
      </header>

      <div role="grid" aria-labelledby={id}
           className="grid grid-flow-col auto-cols-[177.72px] gap-0
                      overflow-x-auto pb-2 pl-[var(--shell-pad)]
                      scrollbar-none
                      [@media(min-width:1440px)]:auto-cols-[195.5px]">
        {children}
      </div>
    </section>
  );
}
```

Why each part:

| Declaration | Evidence |
|---|---|
| `grid-flow-col` | measured `grid-auto-flow: column` |
| `auto-cols-[177.72px]` | measured track ≤1280 |
| `[@media(min-width:1440px)]:auto-cols-[195.5px]` | measured track ≥1440; it is a **step**, not a calc |
| `pl-[var(--shell-pad)]` | measured `padding-left: 28px` |
| `pb-2` | measured shelf vertical breathing room, 284–375px content-driven |
| `role="grid"` + `aria-labelledby` | measured — 56 `row`, 54 `gridcell`, 6 `grid` |

The `Show all` link is **16px / 700 / `#b3b3b3`** and brightens to `#ffffff` on
hover — measured.

The `[@media(...)]` arbitrary-variant syntax is how you express a bare
breakpoint in Tailwind 4. There is no `2xl` default for 1440 that is correct
here (Tailwind's `2xl` is 1536px), so an arbitrary variant is the honest form.

---

## 5. Card

**Change:** radius, the two type steps, and the hover plate. The rest is close.

```tsx
export function Card({ item, onPlay, variant = "square" }: {
  item: { title: string; subtitle?: string; art?: string; href: string };
  onPlay: () => void;
  variant?: "square" | "round";   // "round" = artist
}) {
  return (
    <div role="gridcell"
         className="group relative px-[var(--card-inset)]">

      {/* wrapper carries the hover plate; cell itself stays transparent */}
      <div className="relative rounded-control p-3 transition-colors
                      duration-fast ease-brand group-hover:bg-elevated">

        <a href={item.href} className="block"
           aria-label={`${item.title}${item.subtitle ? `, ${item.subtitle}` : ""}`}>
          <div className="relative">
            <img
              src={item.art} alt="" loading="lazy"
              className={`aspect-square w-full object-cover transition-shadow
                          duration-fast ease-brand group-hover:shadow-raise
                          ${variant === "round" ? "rounded-round" : "rounded-card"}`}
            />
          </div>
        </a>

        {/* hover play plate — pill, black, sits bottom-right of the artwork */}
        <button
          onClick={onPlay}
          aria-label={`Play ${item.title}`}
          className="absolute bottom-5 right-5 grid size-12 place-items-center
                     rounded-pill bg-base text-sub shadow-dropdown
                     opacity-0 transition-[background-color,transform,opacity]
                     duration-fast ease-brand
                     group-hover:opacity-100
                     focus-visible:opacity-100
                     hover:bg-accent hover:text-base hover:scale-105">
          <Play class="size-5 fill-current" />
        </button>
      </div>

      <div className="px-3 pb-2">
        <p className="truncate text-read text-on">{item.title}</p>
        {item.subtitle && (
          <p className="truncate text-label text-sub">{item.subtitle}</p>
        )}
      </div>
    </div>
  );
}
```

**Measured values used:**

| Part | Value |
|---|---|
| artwork radius | `rounded-card` = **6px** |
| artist artwork | `rounded-round` = **50%** |
| title | **16px / 400 / `#ffffff`** |
| subtitle | **14px / 400** |
| play button radius | **9999px** |
| play button transition | `background-color, transform` **150ms** `cubic-bezier(0.3,0,0,1)` |

### ⚠️ One thing to verify before shipping

The computed colour of the subtitle measured **`#ffffff`**, but it *renders*
visibly dimmer than the title in the screenshot. Those cannot both be true.

Most likely explanation: the subtitle sits on a wrapper carrying an opacity or
a colour the child's own computed value does not reflect. The **intent** is
clearly a dimmer grey than the title.

**Do this:** render a shelf in muscify, open devtools on a subtitle, and read
the *rendered* colour. Use `--color-sub` (`#b3b3b3`) unless that measurement
says otherwise. The current spec says 14px; only the colour is in question.

### Truncation

Single line, ellipsis. Upstream's published guideline is that playlist/album
titles fit ~25 characters, artist names ~18, track names ~23 — but **that
threshold was not verified in this capture**, so treat the character counts as
guidance and let CSS handle the overflow.

---

## 6. Player bar

**Change:** mostly unverifiable — see shell.md §7. What *is* established is the
accessible contract, and muscify currently fails one part of it.

```html
<footer aria-label="Now playing bar"      <!-- role=complementary, keep this -->
        class="grid h-player grid-cols-[1fr_2fr_1fr] items-center gap-2
               border-t border-line bg-surface px-4">
  <div class="min-w-0">                     <!-- left: art + titles -->
    <img class="size-14 rounded-control object-cover" src="" alt="" />
    <div class="min-w-0">
      <p class="truncate text-read text-on">Title</p>
      <p class="truncate text-label text-sub">Artist</p>
    </div>
    <button aria-label="Save to your library" class="…">…</button>
  </div>

  <div class="flex flex-col items-center gap-2">   <!-- centre: transport -->
    <div class="flex items-center gap-4">
      <button aria-label="Enable shuffle" class="…"><Shuffle /></button>
      <button aria-label="Previous" class="…"><SkipBack /></button>
      <button aria-label="Pause" class="grid size-8 place-items-center"><Pause fill /></button>
      <button aria-label="Next" class="…"><SkipForward /></button>
      <button aria-label="Repeat" class="…"><Repeat /></button>
    </div>
    <input type="range" class="mus-range w-full" aria-label="Change progress" />
  </div>

  <div class="flex items-center justify-end gap-4">
    <!-- THIS is the fix: muscify has the control with no accessible name -->
    <button aria-label="Show Now Playing view"
            class="transition-transform duration-fast ease-brand hover:scale-105">
      <PictureInPicture2 />
    </button>
    <button aria-label="Open queue" class="…"><ListMusic /></button>
    <button aria-label="Mute" class="…"><VolumeX /></button>
    <input type="range" class="mus-range w-24" aria-label="Change volume" />
  </div>
</footer>
```

Three `slider` roles exist upstream: `Change progress`, `Change volume`, and
`Resize main navigation`. muscify's existing `.mus-range` styles in
`globals.css` are already good — reuse them rather than rewriting.

---

## 7. Now Playing (full-screen view)

**Not captured.** Upstream's background is derived from the album art's
dominant colour, falling back to `#191414` when extraction is not possible.
That fallback value comes from Spotify's published design guidelines, **not**
from this capture — the view was never rendered.

Per the existing `docs/ux-grounding.md`, muscify's version should keep the
art-extraction idea and its own fallback. Do not treat `#191414` as measured.

---

## 8. Loading / empty / error

Not captured either, but these are worth specifying anyway because they are
muscify's problem regardless of what the reference does:

```tsx
// skeleton — match the real card's geometry or the layout jumps on load
<div className="px-[var(--card-inset)]">
  <div className="rounded-control p-3">
    <div className="aspect-square w-full rounded-card bg-elevated animate-pulse" />
    <div className="mt-3 h-4 w-4/5 rounded bg-elevated animate-pulse" />
    <div className="mt-2 h-3 w-3/5 rounded bg-elevated animate-pulse" />
  </div>
</div>
```

Always give skeletons and error states the **same box** as the content they
replace. Layout that reflows on load is the most common cause of a UI feeling
unfinished.

---

## 9. Checklist for the implementing agent

1. Add `--ease-brand` / `--duration-fast`; apply `ease-brand` to every
   interactive transition. *Biggest win, smallest change.*
2. Adopt `tokens.css`; keep muscify's existing `--color-dim` / `--color-muted`,
   which exist for WCAG AA reasons documented in `globals.css`.
3. Convert `Shelf` from the wrapping grid to the rail. Keep the existing
   `aria-labelledby` — it is already right.
4. Set the shell to `grid-cols-[331px_1fr] gap-2 p-2`, top bar `h-16 p-2`,
   `<main>` `rounded-panel bg-surface`.
5. Label the Now-Playing expand control.
6. Verify the subtitle colour against a real render, then use `--color-sub`.
7. Measure card padding in muscify to confirm the derived `12px`.

Then: `npx tsc --noEmit && npx eslint src/ && node --test "src/**/*.test.ts" && npm run build`.

Do not claim any of the above works until it has been **driven in a real
browser**. `docs/../MEMORY.md` §9 records three bugs in this project that were
invisible to review *and* to unit tests, and one "fix" that was never true in
production.
