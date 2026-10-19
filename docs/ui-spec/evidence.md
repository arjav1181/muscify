# Evidence and provenance

Every number in this directory came from one of the captures described here.
Nothing was recalled, and nothing was copied out of the reference's source.

## Legal and ethical basis

This is **passive observation of a publicly rendered page**, using an anonymous
session with no account, no credentials and no authenticated endpoints. It is
the same class of observation as `docs/ux-grounding.md` already documents.

What was read: computed styles and geometry of elements an anonymous visitor
already sees, the accessibility tree, and a screenshot.

What was **not** done, and should not be:

- No account was used. The logged-out client renders the full home page, which
  is all this package needed.
- No request or response bodies, cookies, storage values or console payloads
  were captured. REA redacts these by policy and reports that it did.
- No script source was extracted or decompiled. (See "What REA could not do"
  below — it could not, anyway.)
- No Spotify source code, CSS or minified bundle is redistributed here.
  `evidence/rea-capture-browser-scenario.json` contains a DOM snapshot, which
  is the rendered page's own serialisation — it is kept for reproducibility,
  not as a source to copy from.

Spotify's name, logo, wordmark, icon set and typeface are **not** reproduced.
`tokens.css` supplies colour, geometry and motion values; the identity is
muscify's own.

## Tooling

[REA](https://github.com/morluto/rea) `rea-agents` **6.7.0**, MCP server
registered for Claude Code and OpenCode, `rea mcp doctor` reports healthy with
207/207 tools and a matching catalog digest.

REA's browser surface was used for the structural capture (accessibility tree,
DOM, screenshot, Evidence records). Its `capture-browser-scenario` action
vocabulary is `click · fill · press · select_option · wait_for ·
wait_for_timeout` — there is **no arbitrary JavaScript evaluation action**, so
computed-style resolution was done separately with Playwright. That split is
why the evidence directory has two kinds of file.

### The sandbox trap

REA refused to run at all until this was fixed, and the fix is worth
recording because it will recur:

The `node` on `PATH` in this sandbox is a **bash wrapper** that exports
`LD_LIBRARY_PATH="$REPLIT_LD_LIBRARY_PATH:…"`. That leaks nix glibc 2.33 into
every child process REA spawns, so the system `/usr/bin/ps` (linked against
glibc 2.39) dies at load:

```
ps: symbol lookup error: …/glibc-2.33-47/lib/libpthread.so.0:
undefined symbol: __libc_siglongjmp, version GLIBC_PRIVATE
```

REA reports this as `capability_unavailable` / `provider_id: "process-ownership"`
and refuses to launch *any* supervised child. Fix is a shim that execs the real
node ELF instead of the wrapper: `~/.local/rea-shim/rea`. Both agent MCP
configurations were repointed at that shim, because `rea setup` registers the
`rea.mjs` path directly and its shebang (`#!/usr/bin/env node`) would hit the
same bug.

## Evidence files

| File | Source | What it holds |
|---|---|---|
| `rea-capture-browser-scenario.json` | `rea capture-browser-scenario` | 1.4 MB Evidence: DOM, accessibility tree, screenshot, URL, step records |
| `accessibility-tree.yaml` | same capture, accessibility artifact | the YAML a11y tree — role census and landmarks come from here |
| `computed-tokens.json` | Playwright, computed styles | every distinct colour / type step / radius / shadow in use, with usage counts |
| `layout-geometry.json` | Playwright, geometry | shell regions, shelf internals, hover state, at 7 viewport widths |
| `responsive-tracks.json` | Playwright | `grid-template-columns` resolved track widths per viewport |
| `mobile-geometry.json` | Playwright, device emulation | phone shell at 320 / 390 / 393 px: top bar, tab bar, consent banner state |
| `mobile-rail-tabs.json` | Playwright, device emulation | phone rail track, scroll-snap, card inset, tab item anatomy |
| **`reference-home-1440.png`** | REA screenshot artifact | 1440×900 desktop (sha256 `618c60c7…`) — **start here** |
| **`mobile-iphone-13.png`** | Playwright screenshot | 390×664 phone, shelves + tab bar |
| `mobile-with-upsell.png` | Playwright screenshot | 320×568 phone with the Premium sheet open |
| `mobile-ipad-unsupported.png` | Playwright screenshot | proof that tablet is **not** measurable — see below |

## Reproducing

### Structural capture (REA)

```bash
export PATH="$HOME/.local/rea-shim:$PATH"

/repl/tools/bin/chromium --headless=new \
  --remote-debugging-port=9222 --remote-allow-origins='*' \
  --user-data-dir=/tmp/rea-spotify-profile \
  --password-store=basic --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --window-size=1440,900 about:blank &

rea list-browser-targets http://127.0.0.1:9222 \
  --allowed-origins https://open.spotify.com --json

rea capture-browser-scenario ./scenario-spotify.json --json > capture.json
```

`scenario-spotify.json` is the launch-mode request: viewport 1440×900,
`color_scheme: dark`, `reduced_motion: no-preference`, and
**`service_workers: allow`**. The last one matters — REA blocks service workers
by default and this page does not render its shelves without them.

Two traps from `docs/rea-findings.md` still hold:

- **REA does not navigate for you in connect mode.** Load the page first, then
  attach, or `coverage: attach_limited` and every pre-attach observation is
  gone. `inspect-web-page` run against the already-loaded page this time
  returned `scripts: 0`, `resources: 0` — all of it lost to late attach. That
  is why launch mode is used here instead.
- **Navigate the same target.** A new tab gets a new target id and REA's
  window captures nothing.

### Computed-style measurement (Playwright)

Scripts live in `muscify/scripts/` (they are tooling, not product code, and
`/tmp` is wiped periodically in this sandbox):

- `scripts/measure-reference-ui.mjs` — colour / type / radius / shadow census
- `scripts/measure-reference-layout.mjs` — shell geometry + hover, 7 widths
- `scripts/measure-reference-mobile.mjs` — phone shell, 4 device profiles
- `scripts/measure-reference-mobile-rail.mjs` — phone rail + tab bar anatomy
- `scripts/rea-browser-scenario.json` — the REA request

Run from the **workspace root** (`~/workspace`), which is where Playwright is
installed — muscify's own `node_modules` does not have it:

```bash
cd ~/workspace
node muscify/scripts/measure-reference-ui.mjs \
  https://open.spotify.com/ /tmp/tokens.json 1440 900
node muscify/scripts/measure-reference-layout.mjs
node muscify/scripts/measure-reference-mobile.mjs
node muscify/scripts/measure-reference-mobile-rail.mjs
```

Use the **real** node ELF, not the wrapper on `PATH`, for the same
`LD_LIBRARY_PATH` reason described above. All scripts hardcode
`executablePath: "/repl/tools/bin/chromium"`.

## Mobile capture — three traps, all of which produced wrong data first

These are recorded because each one silently returns plausible-looking
numbers rather than failing.

1. **A resized desktop window is not a phone.** The first mobile run set a
   480px viewport on a desktop context. With no touch support and a desktop
   UA, the page served the **desktop** layout squeezed into the window, and it
   reported a 320px sidebar beside a 416px content column. That is not a
   layout. Use a device descriptor (`devices["iPhone 13"]`) — it carries touch,
   UA and device pixel ratio together.

2. **The consent banner covers the phone UI.** `#onetrust-banner-sdk` renders
   at `z-index: 2147483645`, fills the bottom of a phone viewport, and
   swallowed the real tab bar entirely — so the first "mobile tab bar"
   measurement was 205px of `#eeeeee` cookie text. Clicking its button proved
   unreliable; seeding `OptanonAlertBoxClosed` and `OptanonConsent` for
   `.spotify.com` before navigation works reliably. No account is involved.

3. **The mobile shelf is not `role="grid"`.** A second run anchored on
   `[role="grid"]` and reported **0 shelves** on all three phones, which is
   what a genuinely empty page looks like. It is not empty — the rail is there
   in `evidence/mobile-iphone-13.png`. Anchor on the card artwork instead and
   walk up to the nearest scroller.

A fourth, about tablets: **768px is not measurable from here.** The iPad user
agent is refused outright — the page renders "Unsupported browser"
(`evidence/mobile-ipad-unsupported.png`). iPad reported no rail and no tab bar
because it rendered nothing at all. That is a missing observation, not a
measurement of a tablet layout.

## What REA could not do, and why it matters

Recorded because negative results stop the next person wasting a day:

- **`inspect-web-page` captures nothing if it attaches late.** This run
  produced a 697 KB response of which `scripts.items`, `resources` and
  `frames` were all empty, with `completeness.status: "policy_filtered"` and
  `conditions: ["attach_limited", "policy_filtered"]`. Launch mode is the fix.
- **No JavaScript evaluation action exists** in the browser scenario contract.
  Computed styles are therefore outside REA's reach by design — they need
  Playwright.
- **Cells are virtualised.** Every `gridcell` on the populated shelf reported
  `width: 0`, so per-card gap could not be observed directly. It was *derived*
  (track − artwork) and is labelled as derived in `shell.md` §4.
- **The logged-out client has no player bar**, no album/artist/playlist detail
  pages, and no sub-768px layout. Those are listed as unmeasured in
  `shell.md` §7 rather than filled in.
- **No JS or CSS source was available.** Only 2,115 bytes of inline `<style>`
  in the whole document, with zero CSS custom properties — the design tokens
  live in external stylesheets that were not fetched. This is arguably a good
  outcome: the values in `tokens.css` are *resolved measurements* of what the
  page actually renders, which is more useful than the variables behind it.
- **The mobile mini-player and full-screen player never appeared.** No track
  plays while logged out, so the bar that would sit above the tab bar was
  never on screen. The mobile play plate is specified as INFERRED (touch
  target convention) rather than measured, and labelled as such in
  `components.md` §9.

## Known disagreement with published guidance

Spotify's public design guidelines specify artwork radius **4px** (small/medium)
and **8px** (large). The shipped web player measures a flat **6px** across 146
elements, artwork included.

Both are recorded. `tokens.css` follows the measurement, because that is what
the product actually renders, and notes the guideline so the difference is not
mistaken for an error. `docs/ux-grounding.md` currently states 4/8 — if the two
documents are meant to agree, one of them is wrong and it should be decided
deliberately rather than left to drift.
