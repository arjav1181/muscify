# REA findings, and what they change

Observations taken from `https://open.spotify.com/` at 1440×900 with
`rea-agents` 6.7.0, using its CDP provider (`rea-cdp-browser` v2).

Every number below is from a capture, not from memory or from a screenshot.
Evidence ids and the raw capture are reproducible with the commands in
"How to reproduce". Where REA could not tell us something, that is recorded as a
limitation rather than filled in with an assumption.

---

## 1. Frontend — what the capture shows

**Evidence:** `ev_084c14b2…` (`list-browser-targets`), `inspect-web-page`
against target `D4EB574B…`.

### 1.1 The accessibility tree is much larger than the visible page

1,430 nodes, of which 10,270 bytes of accessible text were retained.

| Role | Count |
|---|---|
| `generic` | 351 |
| `none` | 285 |
| `InlineTextBox` | 222 |
| `StaticText` | 180 |
| `link` | 118 |
| `button` | 78 |
| `row` | 32 |
| `image` | 31 |
| `gridcell` | 30 |
| `listitem` | 25 |
| `heading` | 6 |

Two readings matter. First, `gridcell` 30 / `listitem` 25 / `row` 32 confirms
that shelves really are grids with rows and cells, not `overflow-x` scrollers —
which is what `docs/ux-grounding.md` claimed from an earlier capture and had
never been independently verified. Second, 351 `generic` nodes with no role is
a large fraction of the tree; that is mostly unstyled wrapper `div`s, and it is
the single biggest accessibility finding on the page.

### 1.2 Every content shelf is a named `region`

Exactly five, in this order:

```
Trending songs · Popular artists · Popular albums and singles
Popular radio · Featured Charts
```

This is more useful than it looks. A `region` is only exposed to assistive
technology when it has an accessible name, so these are not decorative
headings — they are landmark navigation. A screen-reader user can jump between
shelves without walking the tree. muscify's shelves render an `h2` and a grid
but do not currently expose a named region, which means its Home page has no
equivalent jump list.

### 1.3 The player bar is a named `complementary` landmark

`complementary` with the accessible name **"Now playing bar"**, containing:

```
Enable shuffle · Previous · Pause · Next · Mute · Show Now Playing view
```

and exactly three `slider` roles: `Resize main navigation`, `Change progress`,
`Change volume`.

Two details worth copying. "Show Now Playing view" is an explicit, named control
for opening the full-screen player — muscify has this but exposes it only as an
icon with no accessible name, so it is invisible to anyone not using a mouse.
And the sidebar resize slider exists at all: the navigation panel is resizable,
which is a real desktop affordance muscify does not have.

### 1.4 Search is a named `combobox`

One `combobox`, named `What do you want to listen to?`. The name is a question
rather than the word "Search", which tells you the control is a suggestion
surface and not a submit button.

### 1.5 Six headings, no tabs

Six `heading` nodes and **zero** `tab` roles on the logged-out page. The
`row`/`gridcell` pattern is used for shelves instead of a tab list, which is why
`docs/ux-grounding.md` concluded that grid-based shelves give arrow-key
traversal for free. No `switch` roles either — the accessibility capture cannot
tell us how Spotify's play/pause toggle is exposed, only that it is a `button`.

---

## 2. Backend / Web API — what REA could **not** tell us, and why

This section is negative results, and they are load-bearing.

**`inspect-web-page` returned zero network requests.** Its coverage marker says
`attach_limited`, and REA's own documentation states `prior_activity_available`
is always `false` — the page had already loaded before REA attached, so the
requests that fetched it were gone. Scripts parsed before attach are still
reported, which is why the capture lists 2 scripts and 0 resources. This is not
a capture that missed traffic; it is a capture that began too late.

**`observe-web-session` captured navigation metadata only.** Arming a 14-second
window and navigating the same target through CDP produced 6 timeline entries —
5 `lifecycle` and 1 `load_failed` — and REA reported:

> "Only navigation metadata is retained; headers, bodies, cookies, console
> values, and payloads are not captured by this tool."

So this surface cannot be used to study request or response shapes at all.

**Navigation is a documented non-goal for the browser provider.** REA attaches
to an already-running target and will not drive it, so there is no supported way
to observe a cold page load.

**Decisive point: Spotify's Web API requires authentication.** The captured page
is the logged-out marketing site. Even a perfect capture would show almost no
catalogue API traffic, because every search, album, playlist and library call
needs a bearer token. Using an account to manufacture that traffic was not
attempted and should not be: it would mean handling someone's credentials to
observe something the public documentation already states.

**Conclusion: the API half of the plan cannot come from REA.** It has to come
from Spotify's published documentation — which the specification sheet already
links, endpoint by endpoint, in §21 — plus our own experiments against the
providers muscify actually uses. REA's value here is confined to the client.

### What to do instead for the backend

Read Spotify's docs for *semantics*, and probe YouTube/Deezer for *behaviour*:

| Need | Source, not observation |
|---|---|
| Rate-limit shape, `Retry-After`, 429 handling | Spotify docs §21; our YouTube quota ledger |
| Search type filters and multi-version results | Spotify `search` endpoint; our `/api/music/search` tabs |
| Playlist visibility (public/unlisted/private) | Spotify playlist concepts; our `supabase`-free schema draft |
| Pagination on large collections | Spotify collection endpoints; our shelves |
| Null-tolerance on removed items | Spotify docs state a track entry can be null; our `pruneCatalog` |

---

## 3. Actions, in priority order

### Frontend

**F1 — Named `region` per shelf.** REA §1.2. Each muscify shelf should render
`<section aria-labelledby={headingId}>` so Home gains landmark navigation.
Small, self-contained, and verified against the reference rather than guessed.

**F2 — Accessible name on the Now Playing expand control.** REA §1.3. muscify
has the control but only as an icon. A screen-reader user currently cannot
reach the full player.

**F3 — Player-bar landmark name.** REA §1.3. muscify's bar is `complementary`
and named "Now playing bar" already. Verify and keep; no change expected.

**F4 — Resizable navigation.** REA §1.3. Spotify exposes
`Resize main navigation`. Lower priority: it is a desktop nicety and adds
persisted layout state.

**F5 — Reduce unnamed `generic` nodes.** REA §1.1. 351 of them. muscify's
count is unknown and should be measured before anything is changed, or this
becomes a refactor guided by a number that is not ours.

### Backend

**B1 — Postgres schema we own, not one we are locked out of.** Auth.js with
Google and GitHub OAuth; any Postgres by connection string. A library document
per user, plus playlists, items, follows and play events, with retention on the
only unbounded table.

**B2 — Keep anonymous sync working unchanged.** It is already built, tested and
degrades correctly. An account must be an upgrade, never a requirement.

**B3 — Adopt, never clobber.** First sign-in moves the anonymous library onto
the account only when the account has none, so nobody loses playlists by
registering and no synced library is overwritten.

**B4 — Derive the social surface from what §1 actually showed.** REA observed
no Messages, no Jam, no Blend and no profiles in the client. That is evidence
those are app-level features requiring a different sign-in state, not things a
logged-out page reveals. Do not build them on the assumption that they are
simple.

---

## 4. How to reproduce

Two environment problems have to be solved first; both are specific to a Nix
sandbox and neither will apply on a normal machine.

1. **`ps` is broken.** REA shells out to it for process-ownership checks and the
   Nix `ps` links against a different glibc:
   `undefined symbol: __libc_siglongjmp, version GLIBC_PRIVATE`. `/usr/bin/ps`
   works; it is simply not first on `PATH`.

   ```bash
   export PATH="$(dirname "$(which node)"):/usr/bin:/bin"
   ```

2. **Chromium needs REA's Linux flags** and its own profile:

   ```bash
   chromium --headless=new \
     --remote-debugging-port=9222 \
     --remote-allow-origins='*' \
     --user-data-dir=/tmp/rea-profile \
     --password-store=basic \
     --no-sandbox --disable-gpu --disable-dev-shm-usage \
     --window-size=1440,900 about:blank
   ```

   `--password-store=basic` is not optional on Linux: a locked desktop keyring
   stalls Chrome before its first navigation.

Then:

```bash
rea list-browser-targets http://127.0.0.1:9222 \
  --allowed-origins https://open.spotify.com --json

rea inspect-web-page http://127.0.0.1:9222 TARGET_ID \
  --observation-ms 3000 --include-accessibility-text --json
```

### Reusing this for other pages

The same three commands work for any public page. Two rules learned here:

- **Navigate the same target.** Opening a new tab creates a new target id, and
  REA's window is bound to one target — a new tab during the window captures
  nothing.
- **REA does not navigate for you.** Load the page first, then attach. Anything
  that happened before the attach is gone, and `coverage: attach_limited` will
  say so.