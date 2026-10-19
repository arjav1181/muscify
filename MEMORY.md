# MEMORY.md

Handoff document for muscify. Read this before doing anything else in this repo —
it records decisions, verified state, and the traps that have already cost time.

**Last updated:** after `a30d0fa` (deployed READY as `dpl_38jbwNmPib7nNv7QHnMqVTNaua`),
plus an uncommitted UI-spec package under `docs/ui-spec/`.
**Live site:** https://muscify-pearl.vercel.app

---

## 0. The UI spec exists — read it before touching the UI

`docs/ui-spec/` is a measured, hand-off-ready specification of a comparable
player's UI, built for exactly the "UI overhaul stages 3+" work in §6. Every
value is labelled **MEASURED** or **INFERRED**.

Start with `docs/ui-spec/README.md`. The headline: **our token layer is already
correct and was independently confirmed** — colours, radii and the type ramp
all match. Do not rewrite `globals.css`.

What it establishes that we did not have:

- the shell geometry (331px rail, 64px top bar, 8px gutters)
- the rail pattern — we use a wrapping `grid-cols-*`, upstream is
  `grid-auto-flow: column` with fixed tracks
- `ease-brand` = `cubic-bezier(0.3, 0, 0, 1)` at 150ms, which Tailwind's stock
  `ease-out` is not. Cheapest change, biggest perceptual difference.
- **a phone layout**, which we have none of. Our shell is
  `grid-cols-[331px_1fr]` unconditionally — a 331px sidebar on a 390px phone.

Capture scripts are in `scripts/measure-reference-*.mjs`. Run them from the
**workspace root** (that is where Playwright is installed), and use the real
node ELF rather than the wrapper on `PATH` — see §10.

---

## 1. What this project is

A free, ad-free music player at `/home/runner/workspace/muscify`. Next.js 16.4.2,
React 19.3, Tailwind 4, Zustand. Plays from YouTube, Deezer, SoundCloud links
and SomaFM radio. Spotify-*shaped* interface, deliberately not a Spotify clone:
their interaction patterns, our own font, logo and marks.

A port of a Python `play_music.py`. No Spotify API — retired Nov 2024, and the
app owner would need Premium as of Feb 2026. `src/lib/spotify/` is deleted.

---

## 2. ⚠ Rotate the Vercel token

The Vercel token has been in plaintext chat across many turns. It has write
access to **all 13 projects** on the team, and the repo is now wired to GitHub
for automatic deploys — so it is one automated push away from being used that
way.

Ask the user to rotate it. Do not echo the value into any file, commit or log.
Vercel team id: `team_QQ5rugCtLz8TwBi17VepM08p`.

---

## 3. Environment traps

These are specific to this sandbox and have each cost real time.

### 3.1 The lockfile trap — highest cost of the session

npm records whichever registry host it resolved from. This sandbox installs
through an internal proxy, so anything added with `npm install` lands in
`package-lock.json` pointing at `http://package-firewall.replit.internal/npm/…`,
which **does not exist on the build host**.

**Symptom:** deploy goes to `ERROR`, `errorCode: ENOTFOUND`, *no compiler output
and no error message*. The local build is green, tsc is green, all tests pass.
It reads exactly like a transient network fault and is not one.

**After every `npm install`, run:**

```bash
python3 /tmp/opencode/check_lockfile.py   # recreated if /tmp was wiped
```

or inline:

```bash
python3 -c "
import json
d=json.load(open('package-lock.json'))
bad=[(k,m.get('resolved')) for k,m in d['packages'].items()
     if isinstance(m.get('resolved'),str)
     and not m['resolved'].startswith('https://registry.npmjs.org/')]
print('non-public:', bad if bad else 'none')"
```

**The build host is the only oracle.** A subtler version of this trap cost a
deploy this session. Rewriting the proxied URLs with a sloppy `split('/npm/')`
dropped the leading slash and produced:

```
https://registry.npmjs.orgpreact-render-to-string/-/preact-render-to-string-6.5.11.tgz
```

Fetching every tarball and hash-checking them all **passed** — because this
sandbox resolves essentially any hostname through its package proxy, so the
malformed host resolved anyway and served a byte-identical tarball. The URL was
wrong; the content was right. Only a check that *parses* the URL can tell those
apart, so the audit must use `urlparse` and require scheme, host **and** a path
beginning with `/` — not a string prefix test and not a successful fetch.

CI's first step enforces the non-proxied case, so it fails the build rather than
the deploy. It does not catch a malformed-but-npmjs-prefixed URL; only the build
host does.

### 3.2 `/tmp/opencode` is wiped periodically

Recreate scripts when missing. Persistent alternatives that survived:
`/home/runner/workspace/muscify/docs/rea-findings.md`, the CI workflow, and
anything committed to the repo.

### 3.3 SomaFM refuses this sandbox's IP

In-browser playback fails with `error: 4` / HTTP 403 on every station.
`curl` gets `206` to the same URL. Verified with a direct A/B: an `<audio>`
element **with** `crossOrigin` and **without** both fail identically, so it is
not the CORS work. The user has confirmed **audio does play** on the real site.

**Consequence:** anything behind "a track is playing" — the whole player bar,
lyrics, queue, EQ — cannot be verified from here. Say so rather than claiming it
was tested.

### 3.4 REA cannot run without a sanitised PATH

`ps` is broken (nix copy links against the wrong glibc:
`__libc_siglongjmp`). REA shells out to it for process-ownership checks.

```bash
export PATH="$(dirname "$(which node)"):/usr/bin:/bin"
```

Chromium additionally needs REA's Linux flags or it exits silently:
`--remote-debugging-port=9222 --remote-allow-origins='*' --password-store=basic
--no-sandbox --disable-dev-shm-usage`, its own `--user-data-dir`, and it must be
launched in a way that survives the parent shell being killed (the `background`
tool flag works; `nohup setsid &` inside a command does not).

### 3.5 Next 16 gotchas

- **`export const revalidate` is rejected** under `cacheComponents`. Use per-fetch
  `next: { revalidate }`. This 500'd a route in production.
- Read `node_modules/next/dist/docs/` before writing route handlers; `AGENTS.md`
  at the repo root is auto-generated by `next dev` and carries the same warning.

### 3.6 Deploying

`POST /v9/projects/{name}/link` is the endpoint for the Git integration — **not**
`PATCH` with a `link` property, which returns
`Invalid request: should NOT have additional property 'link'`.

Deploy is now push-driven: `git push origin main` → Vercel builds. The manual
upload script (`/tmp/opencode/deploy_vercel.py`) is no longer needed.

**Always verify the push landed:**

```bash
git log origin/main..HEAD --oneline | wc -l   # must be 0
```

A backgrounded push failed silently once while the commit and tests all
succeeded. `gh auth setup-git` is required in any new shell; without it the push
dies with "Authentication failed".

---

## 4. Product decisions already made

| Decision | Answer |
|---|---|
| Spotify Web API | **Dropped.** Retired; would need Premium. |
| UI reference | Spotify's layout, colours, type scale and spacing. Our own font/logo/icons. "Push much closer to Spotify." |
| Fonts | Never Circular (licensed). Measure the metrics, ship a different family. |
| Icons | Lucide only, never Spotify's set. |
| Backend | **Supabase rejected** for lock-in. Postgres by connection string + Auth.js. |
| Auth | **Google + GitHub OAuth.** No passwords stored, no email sending. |
| Sync scope | Library + settings + stats/play log + social. Anonymous sync must keep working regardless. |
| Accounts | Optional. Never a gate on listening. |
| Podcast discovery | YouTube. Audiobooks deliberately **not** built — unverified uploads, no rights signal. |
| Redirect/scrape fallback | YouTube's public results page when the API quota is gone. Permitted as a source; never documented to users. |
| Track switching | Free streams never end; `continue: "any"` never resumes. Always `load()` a new `src`. |

---

## 5. What is built and verified

Only claim things on this list as working.

### Verified live on the deployed site
- Home, Library, Radio, Podcasts, Settings all render; **zero JS errors**
- Accounts, unconfigured: `/api/auth/session` → 404 (not 500), no dead `/signin`
  link, Account row says accounts are not configured. The default deployment is
  behaviourally unchanged.
- Auth.js + Postgres verified against a **real Postgres 16**: 9 integration tests
  covering the double-encoding guard, identity namespacing, no-email-merge, and
  device/user table isolation. Run with `MUSCIFY_DATABASE_URL` set.
- **Podcasts**: `/podcasts` → search returns 18 shows + episodes (MrBallen,
  Rotten Mango, Black Girl Gone, Crimes of Reddit, True Crime Retold)
- **Artist search**: "pritam" → `Pritam` first at 1.46M followers; topic
  archives and typo handles gone (Issue #3)
- **Shelf landmarks**: 6 named regions, `unresolved: 0`, 82 gridcells
- Player bar is `complementary` named "Now playing bar" (F3)
- Now Playing expand carries `aria-label="Show Now Playing view"` (F2)
- `/api/library` returns **501** with no backend configured — correct
- Accessibility audit: **0 findings** (was 85)

### Built, unit-tested, not verifiable here
Everything behind playback: lyrics, queue + reorder, EQ, loudness normalisation,
sleep timer, ducking, crossfade, context menus, taste controls, sync.

### Tests
**256 passing**, plus 9 Postgres integration tests. `node --test "src/**/*.test.ts"`.
CI is green.

### Built, not verified here
Sign-in and sign-out themselves. They need real Google/GitHub OAuth credentials
and a redirect URI registered with both providers; neither is configured on this
deployment, so `/api/auth/[...nextauth]` correctly 404s. Everything around them
— the identity mapping, the library scoping, adoption — is tested against a real
database.

---

## 6. Outstanding work

Ordered by value.

1. **Register the OAuth apps and set the env vars.** The last step of B1:
   `AUTH_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`,
   `GITHUB_ID`/`GITHUB_SECRET`, `MUSCIFY_DATABASE_URL`, then apply
   `db/schema.sql`. Until someone does this, accounts are correctly inert.
2. **A real visual redesign** — see section 9. The only genuinely open item.

**Gapless (§16) is closed, not deferred.** Every source that ends is a
single-player SDK: `loadVideoById` replaces the video on the one YouTube player
the SDK gives you; Deezer and SoundCloud are the same shape. The one source
that could double-buffer is radio, which never reaches an end. Reasoning and the
rejected double-player alternative are in `docs/gapless.md`. It would need raw
streams through Web Audio, which is a sourcing decision, not a feature.

**F5 done where it mattered.** Library grids are named lists, tiles are
listitems, the filter row and folder row are named groups. Verified with real
content: role=list 2, role=listitem 9. Remaining unnamed nodes are inert layout
wrappers — removing them is regression risk for a number, not for users.

**Offline (§17) is built**: `public/sw.js` caches the offline page and hashed
build assets, never `/api/*` and never third-party media. Registered in
production only. It does **not** cache audio for offline listening — that is a
rights question and most free streams are not CORS-readable.

**Done, and previously mislabelled as outstanding:** playlist folders (§11),
F4 resizable nav, listening stats (§12 — the view already existed; this file
wrongly called it missing), mobile volume, mobile transport.
9. **Follows / social (B4).** REA observed no Messages, Jam, Blend or profiles
   in the logged-out client, so do not assume they are simple. The
   `muscify_play_daily` rollup and `muscify_accounts` table are already there to
   build on.

---

## 7. Traps in this codebase specifically

Each of these has already caused a real bug.

- **`JSON.stringify(x)::jsonb` double-encodes.** postgres.js has already
  JSON-encoded a string parameter by the time the cast applies, so the row is
  stored as a JSON *string scalar* and reads back as a string — `snapshot.playlists`
  is `undefined` and the library silently comes back empty. Pass the **object**.
  This shipped in the Neon store and had never run, because no deployment has a
  database. Both writes are fixed and both reads now parse defensively so rows
  already written in the broken form self-heal on the next write.
- **`URL ? {skip} : undefined` skips when the URL EXISTS.** The Postgres
  integration suite was written this way and therefore never ran once, while
  looking complete. Always confirm a "skipped" suite is skipped for the right
  reason — `node --test` reports `suites 1, tests 0`, not an error.
- **A Postgres URL in this sandbox points at another project.** `DATABASE_URL`
  hosts `feedback`, `users`, `conversations`, `messages`, `overrides`. Give
  muscify its own database; never point it at that.
- **`normalise()` drops undeclared fields.** `updatedAt` was stripped, so sync
  silently never adopted anything while looking healthy. It is now a declared
  field on `LibrarySnapshot` with a regression test.
- **`getStore()` must never read bare `DATABASE_URL`.** It is one of the most
  widely-used variable names there is. It already pointed this sandbox's
  Postgres at muscify. Now requires `MUSCIFY_DATABASE_URL`, or
  `MUSCIFY_SYNC_BACKEND=neon` as an explicit opt-in.
- **`videoCategoryId` is still a filter trap.** Removed from all three call sites
  (`trendingYoutube`, `searchYoutube`, `channelVideos`), but the chart still
  returned nothing with quota at 1/9000. The remaining cause is NOT observable
  from here — the API key lives in Vercel's environment. `trendingYoutube` now
  falls back to a search rather than throwing, so the shelf degrades instead of
  saying "youtube: empty chart". **That error was visible in production and sat
  in a screenshot nobody read.** Look at the screenshots.
- **Never claim a fix without exercising it.** Twice this session a commit
  message asserted something that was false in production:
  - "artist search is fixed" — `videoType=music` is a **400**, swallowed by a
    `catch`, and `topicDetails.musicArtistName` is `null` on every result.
  - "the logo is gone" — it was a downscaled screenshot, not a real regression.
- **Read the live DOM, not the JSX, for accessibility.** A regex over
  `player-bar.tsx` reported twelve unnamed buttons; all twelve were named.
- **An `<audio>` element must set `crossOrigin` before `src`**, or Web Audio
  taints the element and outputs silence.
- **`useMemo` is not for effects.** `react-hooks/set-state-in-effect` caught a
  fetch inside it; the house pattern is `useResource`, which also keys responses
  so a superseded reply cannot overwrite a newer one.
- **YouTube `videoCategoryId` is auto-assigned.** Filtering on `"10"` (Music)
  rejected every result and fell back to the same broken query — that shipped.
  Never use it as a filter.

---

## 8. How to verify

```bash
npx tsc --noEmit
npx eslint src/
node --test "src/**/*.test.ts"
npm run build
gh run list --limit 3            # CI
```

Then, against the live site — this is what actually finds bugs:

```bash
# waits for the git build, then screenshots
VERCEL_TOKEN=… VERCEL_TEAM_ID=… python3 /tmp/opencode/await_and_shoot.py $(git rev-parse HEAD)

# drive the real UI
python3 /tmp/opencode/prove_lyrics.py     # proves the player bar + lyrics reachability
python3 /tmp/opencode/drive.py            # 13 checks
```

Playwright must be pointed at the working Chromium — its bundled one lacks
system libraries:

```python
p.chromium.launch(executable_path="/repl/tools/bin/chromium",
                  args=["--no-sandbox", "--disable-dev-shm-usage"])
```

---

## 8b. Mobile — tested on the phone, not the desktop

Most of the early work was desktop-shaped and verified at 1440px while the user
was testing at 390. Auditing properly found four bugs, all invisible from a
desktop viewport:

- **no transport controls in the bar** — play/pause/prev/next lived in a
  `hidden md:flex` group, so a phone had no transport in the persistent bar
- **no volume anywhere** — `VolumeControl` was in that same hidden group; it now
  lives on Now Playing below md, which is where Spotify puts it
- **the progress bar could not be dragged** — it used `onMouseDown`/`onMouseMove`,
  which do not fire for a finger. Pointer events throughout now
- **the nav chip row wrapped onto three lines** — replaced by `MobileDrawer`

Audit scripts live in `/tmp/opencode/mobile_audit.py` (structure at 390x844) and
`verify_drawer.py` (drawer behaviour). Recreate if `/tmp` was wiped.

Note `document.body` has `overflow: hidden` from the app's own CSS, because the
scroll container is inside `<main>`. Body scroll is therefore never the thing
that moves behind a drawer, and "is body scroll locked" is the wrong question to
ask about a drawer — assert on the scroll container instead.

---

## 9. The method that matters

Three bugs this session were invisible to review *and* to unit tests: a guard
that compared source instead of track, a ref that was never attached, a panel
gated on `recentlyPlayed` while reading `taste.plays`. All three were found by
driving a real browser.

Counter-examples, where looking was actively misleading:

- "no player bar" — the bar is `<footer>` when idle and `<aside>` when playing
- "0 show tiles" — my script filled the *global* search input, not the page's
- "the logo disappeared" — a downscaled screenshot

So: **measure, don't infer.** When a claim cannot be checked, say it cannot be
checked rather than asserting it.

### A regression hidden by a number moving the wrong way

Adding `role="list"`/`role="listitem"` is purely additive, so the unnamed count
should only fall. It rose. That is what made it worth investigating instead of
committing: the library was empty, so none of the grids were in the DOM. Driving
the UI to create a playlist and a folder then showed the real bug — the empty
branch returned without `FolderBar`, so creating a folder (which auto-selects an
empty one) left the user with no chips, no Create button and no way out.

**An additive change that makes a metric worse is reporting a measurement
problem or a regression. Neither is a reason to keep going.**

### The same mistakes, four more times

- "the player bar is missing" — measured `nav`, which is the global top nav
- "the resizer does not work" — measured `nav` again, so the sidebar never moved
  in the measurement; it worked fine (240 → 304, Home → 180, End → 420)
- "the trending shelf is fixed" — it was not; the same screenshot that showed it
  broken was not looked at until someone complained
- "the mobile tiles are clipping" — measured: 165x165 tile, 64px title, flush to
  the edge. `line-clamp-2` working as intended, read as a bug off a screenshot
- "the resizer does not work" — measured `nav`, which is the global top nav
- "folders are broken" — measured wrong element, twice

And the biggest one, which is not a measurement error but a judgement error:
**the UI overhaul was invisible.** What shipped was tokens, radii, gutters and
`aria-labelledby` — real changes that nobody can see without a before/after. The
request was "absolute next level, exactly like Spotify". Repainting a layout is
not that. When work is described as user-facing, check whether a user could
name what changed; if not, the work was aimed at the wrong target.

---

## 10. REA setup, and the trap that blocks it

REA (`rea-agents` 6.7.0) is installed and working: CLI at
`~/.local/rea-shim/rea`, MCP registered for Claude Code and OpenCode,
`rea mcp doctor` healthy at 207/207 tools, skill installed.

**It does not run out of the box here, and the error does not say why.**

The `node` on `PATH` is a *bash wrapper* that exports
`LD_LIBRARY_PATH="$REPLIT_LD_LIBRARY_PATH:…"`, leaking nix glibc 2.33 into
every child REA spawns. The system `/usr/bin/ps` (glibc 2.39) then dies at
load with `undefined symbol: __libc_siglongjmp, version GLIBC_PRIVATE`, and
REA refuses to launch *any* supervised child, reporting
`capability_unavailable` / `provider_id: "process-ownership"`.

Fix: a shim that execs the **real** node ELF
(`/nix/store/9cyx…-nodejs-24.13.0/bin/node`) instead of the wrapper. Both agent
MCP configs were repointed at it, because `rea setup` registers `rea.mjs`
directly and its `#!/usr/bin/env node` shebang hits the same bug. Same
constraint applies to the Playwright measurement scripts.

### Measurement traps that returned plausible wrong numbers

Each of these failed *silently* with plausible-looking output:

- **REA in connect mode attaches too late.** `inspect-web-page` returned 697 KB
  in which `scripts` and `resources` were both empty —
  `completeness: policy_filtered`, `conditions: ["attach_limited", …]`. Use
  `capture-browser-scenario` in **launch** mode, and set
  `service_workers: "allow"` or the shelves never render.
- **REA's browser scenario has no JS-evaluation action.** Computed styles are
  outside its reach by design; use Playwright for the token layer.
- **A resized desktop window is not a phone.** No touch + desktop UA makes the
  site serve the desktop layout squeezed — it reported a 320px sidebar beside
  a 416px column. Use a real device descriptor.
- **The OneTrust consent banner covers the phone UI** at
  `z-index: 2147483645`, and the first "mobile tab bar" measurement was 205px
  of cookie text. Seed `OptanonAlertBoxClosed` before navigating; clicking the
  button was unreliable.
- **The mobile shelf is not `role="grid"`.** Anchoring on it reported 0 shelves
  on all three phones, which looks exactly like an empty page. Anchor on the
  card artwork instead.
- **768px is not measurable here.** The iPad UA is refused outright
  ("Unsupported browser"). iPad showed no rail and no tab bar because it
  rendered nothing — that is a missing observation, not a tablet layout.

---

## 11. GitHub / Vercel

- Repo: https://github.com/arjav1181/muscify (public, MIT, issues enabled)
- Open issues: #1 playlist folders · #2 no service worker · #3 artist search ·
  #4 two partial UX patterns
- Vercel project `muscify`, Git-linked to `main`, verified by pushing and
  watching a build.
- `.github/workflows/ci.yml`: lockfile check → types → lint → test → build.
- The spec sheet is committed at `SPOTIFY_DETAILED_SPEC_SHEET.html` (24
  sections). Most of it describes a commercial platform — podcasts, audiobooks,
  video, Connect, social, billing, the developer platform — and is out of scope
  for a free player. What is in scope is §16 audio processing, §17 offline,
  §11 library, §12 discovery, and the error-state vocabulary in §22.