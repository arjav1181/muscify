# Mobile UI

Measured with real device emulation (touch, mobile UA, device pixel ratio) at
**320×568, 390×664 and 393×727**. Method and raw captures:
[evidence.md](./evidence.md).

> ⚠️ **Read this before trusting the numbers.** The first attempt at this used
> a desktop browser context with a small viewport, and produced completely
> wrong results — a 320px rail sitting beside a 416px content column, because
> without touch/mobile emulation the page serves the **desktop** layout
> squeezed into a narrow window. Every number below comes from
> `devices["iPhone 13"]`-style descriptors, not from a resized desktop window.
> If you re-capture this, use `scripts/measure-reference-mobile-rail.mjs`.

---

## 1. The shape of it

Desktop and mobile are the **same design at two densities**, not two designs.
Same colours, same radii, same type ramp, same rail pattern. What changes:

| | Desktop | Mobile |
|---|---|---|
| Navigation | 331px sidebar | **70px bottom tab bar** |
| Search | 474×48 field in the top bar | **a tab**, not a field |
| Top bar height | 64px | **56px** |
| Top bar padding | 8px | **16px** |
| Shelf heading | 24px / 700 | **20px / 700** |
| Card track | 177.72px → 195.5px | **168px, fixed** |
| Card inset | 12px (derived) | **8px** |
| Content padding-left | 28px | **16px** |

The last three rows are the ones people get wrong. The mobile card track is
**fixed at 168px at every mobile width measured** — it is *not* fluid, and it
does *not* become two columns on a small phone.

## 2. Top bar — 56px

```
height     56px          (desktop: 64px)
background #000000
padding    16px          (desktop: 8px)
```

Measured children at 390px wide:

| Element | Size | Radius |
|---|---|---|
| logo | 88×24 | — |
| "Open App" button | 93×32 | `9999px` |
| menu button | **48×48** | `9999px` |

**There is no search field in the mobile top bar.** Search moves into the tab
bar. That is the single most important structural difference and the easiest
to miss, because it means the top bar has room for an account CTA instead.

The menu button is a **48×48** touch target. Desktop icon buttons in this UI
are 24–32px because a mouse makes that forgiving; on touch they must be 48px.
Match that in muscify or the mobile build will feel broken in the hand.

## 3. Tab bar — 70px, and it is not a solid bar

```
height      70px
position    fixed
width       100%
background  linear-gradient(
               rgba(0,0,0,0.7),
               rgba(0,0,0,0.9),
               rgb(18,18,18)
             )
```

Note what that is: **a transparent-to-surface gradient, not a flat fill.** It
fades content out as it scrolls under, so the bar has no hard edge. Measured
`backgroundColor` is `transparent`; the colour lives entirely in
`backgroundImage`. If you implement this as `bg-base` it will look heavier and
more boxed-in than the reference, and the difference is immediately visible.

### Tab items

| Part | Measured |
|---|---|
| item width | ~98px at 390px viewport (4 items) |
| icon | **24×24** |
| label | **11px / 400**, `margin-top: 0` |
| active icon | `#ffffff` |
| active label | `#ffffff` |
| inactive icon | `#b3b3b3` |
| inactive label | `#b3b3b3` |
| active marker | `aria-current="page"` |

Measured labels: `Home`, `Search`, `Your Library`, `Premium`.

Only `aria-current` distinguishes the active tab — there is no underline, no
pill, no filled circle. The active state is **colour alone plus the
`aria-current` attribute**, so colour is not the only channel a user has, and
muscify should keep it that way.

The 11px label is the smallest text in the entire UI. It is below
`--text-micro` (12px). That is worth knowing before adopting it: it is
measured, but it is genuinely small, and WCAG does not set a minimum size, it
sets a contrast requirement. `--color-sub` at 11px is the case to check.

## 4. The rail — same pattern, fixed 168px track

```
display              flex
flex-direction       row
overflow-x           scroll
scroll-snap-type     x mandatory      ← NOT present on desktop
padding              0
```

Measured identical at 320, 390 and 393:

```
track                168px           (fixed)
artwork              152px
card inset           8px             (168 − 152 = 16, 8 per side)
visual gap           16px
content padding-left 16px
items                20
scrollWidth          3376px
```

**The differences from desktop, precisely:**

1. `scroll-snap-type: x mandatory` — desktop has `scroll-snap-type: none`.
   Cards land on whole boundaries on mobile. This is a touch affordance and
   there is no equivalent on a mouse.
2. `padding-left: 16px` — desktop is 28px.
3. Card inset is **8px**, not the 12px derived for desktop.
4. Track is **fixed**, not a breakpoint step.

## 5. Cards

Same as desktop where it matters — artwork `rounded-card` (6px), title
**16px / 400 / `#ffffff`**. The subtitle question raised in
[components.md](./components.md) §5 is unresolved on mobile too; the same
verification step applies.

## 6. Shelf heading drops to 20px

```
mobile   20px / 700 / #ffffff    ← measured
desktop  24px / 700 / #ffffff    ← measured
```

Not a different weight, not a different colour. Only the size, and only by one
step. This is `text-[20px]` on mobile rather than `text-title`, or a
responsive variant of the title token.

## 7. Not captured

- **Tablet (768px).** The iPad descriptor gets **"Unsupported browser"** from
  this site — Spotify blocks that user agent outright. It is not that the
  layout was unmeasured; the page refused to render. Do not infer a tablet
  layout from the fact that iPad showed no rail and no tab bar, because it
  showed *nothing*. A capture needs a user agent the site accepts.
- **Mini player / full player on mobile.** No track plays while logged out, so
  the bar that appears above the tab bar was never on screen.
- **Any modal measurement.** A Premium upsell sheet does render, but it is a
  logged-out marketing surface rather than part of the product's own UI, so it
  is not specced here. Its prominent feature — a large border radius and an
  underlined-terms line — is visible in
  `evidence/mobile-iphone-13.png`.
- **Landscape, foldables, and anything below 320px.**
