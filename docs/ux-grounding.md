# UX grounding — where muscify's patterns come from

Two sanctioned sources. No reverse engineering, no credentials, no internal
endpoints.

## 1. Spotify's published Design & Branding Guidelines

`developer.spotify.com/documentation/design`. Relevant extracts:

| Guideline | What we do with it |
|---|---|
| "Extract artwork color for background… If not possible, use Spotify color `#191414`." | Now Playing derives its backdrop from the album art; falls back to `#191414`. |
| Artwork radius 4px (small/medium), 8px (large) | Applied to every art surface. |
| Never crop artwork, never overlay text or controls on it | Art is rendered whole; titles live beside or below it. |
| Layout should fit: playlist/album 25, artist 18, track 23 chars | Truncation thresholds in grid cells and list rows. |
| Explicit badge for explicit tracks | Badge rendered in-row and included in the accessible name. |
| Like is a `+` icon with active state + confirmation toast | Already shipped. |
| Default platform sans-serif → Helvetica Neue → Helvetica → Arial | Font stack. |
| App name must not include or resemble "Spotify" | muscify. |

**Attribution note:** the guidelines require the Spotify logo when you display
*Spotify-sourced* metadata. muscify uses no Spotify metadata — the Web API was
dropped — so nothing here is attributed. If Spotify content is ever added, the
logo requirement comes back with it.

## 2. REA passive observation of the public web player

`rea inspect-web-page` against the unauthenticated `open.spotify.com` page.
Captured the accessibility tree only: roles, names and states. No scripts, no
network, no storage values (the capture reported `values_redacted: true`).

Nothing was extracted beyond what the page already renders to a visitor, and no
session was used.

### The interaction grammar that matters

**Content rails are grids, not scrollers.**

```
grid  "Your Library"      row (32)  → gridcell (30)  → listitem (25)
grid  "Popular radio"
grid  "Featured Charts"
grid  "Trending songs"
grid  "Popular artists"
grid  "Popular albums and singles"
```

Spotify models every shelf as `role="grid"` with rows and cells, which gives
arrow-key traversal for free. A plain `overflow-x` rail does not. Ours should
carry the grid roles and actually respond to arrow keys.

**Each item has two distinct controls.**

- the item itself: `"{title} {artist}"`
- an explicit play affordance: `"Play {track}"`, `"Play {name}"` for artists

and artist entries name themselves `"{name} Artist"`. Two controls, because
"open this item" and "start playing" are different intents.

**The player bar is a complementary landmark.**

```
complementary  "Now playing bar"
```

with `Show Now Playing view`, `Enable shuffle`, `Previous`, `Pause`, `Next`,
`Mute`, and three `slider` roles (seek, volume, and one more).

**Other observed conventions**

- `Explicit` is part of the accessible name, not just a visual badge.
- Dropdowns use `hasPopup: listbox` + `expanded`.
- Strict heading hierarchy — 27 nodes at `level: 1`.

### What we adopt

1. Shelves as `role="grid"` with arrow-key navigation.
2. `Play {track}` alongside each item's main control.
3. Player bar as `complementary` named "Now playing bar".
4. `"{name} Artist"` for artist items.
5. `Explicit` in the accessible name.
6. Artwork-colour backdrop in Now Playing, `#191414` fallback.

### What we do not

No Spotify trademark, logo, or green-as-brand. Spotify green appears only as a
colour choice. muscify is its own product that borrows interaction patterns.