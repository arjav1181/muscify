# Gapless playback — why it is not built

Spec §16 asks for gapless. This records why it is not here, with the evidence,
because "we decided not to" and "we could not" are different answers and only
one of them is true.

## The constraint

Every source that actually *ends* is a single-player SDK embedding:

| Source | Mechanism | Can the next item be buffered ahead of time? |
|---|---|---|
| `youtube` | one `YT.Player` in an iframe; `loadVideoById(id)` replaces whatever is loaded | No |
| `deezer` | Deezer widget iframe | No |
| `soundcloud` | SoundCloud widget iframe | No |
| `radio` | a plain `<audio>` element | Yes — but pointless |

`loadVideoById` is the whole problem. It is a *replace* operation on the one
player the SDK gives you. There is no second deck to cue into, and no API that
accepts "start fetching this now, play it later" — `cueVideoById` exists but
loading anything cues *over the currently playing video*, which stops it.

The one source that could genuinely double-buffer is `radio`, because it owns a
real `<audio>` element. It is also the one source where the question does not
arise: SomaFM stations are continuous streams that never reach an end, so there
is no track boundary to be gapless across.

## Why double-buffering one engine is not the answer

The obvious workaround is two players per source. It is worse than it sounds:

- The IFrame players are third-party iframes. Two live ones per source means up
  to eight embedded documents on one page.
- Each keeps its own buffer, so memory roughly doubles for a benefit that is
  invisible on the sources that dominate (YouTube is nearly all of them).
- The `activeSource` guard in `player-host.tsx` exists because these engines
  report state changes during teardown, and a second player doubles those races.
  Getting it wrong does not degrade gracefully — playback dies on every skip,
  which is a failure mode already fixed once in this codebase.
- The gain is a few tens of milliseconds of overlap on an SDK that decides its
  own buffering anyway. There is no guarantee YouTube honours a cue the way a
  raw `<audio>` would.

## What would actually close it

Not an engineering change here — a different playback stack. Fetching the raw
stream and driving it through Web Audio, the way `radio-engine.ts` already does,
would make gapless straightforward: two `AudioBufferSourceNode`s scheduled
against the same clock, which is sample-accurate and genuinely gapless.

That is a large change with its own costs — CORS on third-party media, higher
memory, more of the app's own audio graph to own — and it is a decision about
how the app sources audio, not a feature to bolt on.

## So

Left out on purpose, with the reason written down. If raw-stream playback is
ever adopted, this becomes straightforward rather than unknown, and the notes
above are what to read first.