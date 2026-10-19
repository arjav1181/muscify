import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "muscify — a music player that asks for nothing",
  description:
    "Free, ad-free, no account required. Plays YouTube, Deezer, SomaFM radio and SoundCloud links in a Spotify-shaped interface.",
};

/**
 * The landing page.
 *
 * Served at `/` only when `MUSCIFY_LANDING=1`; otherwise the player is at `/`
 * and this page is reachable at `/welcome` for anyone who wants to see it. The
 * middleware decides, not the filesystem, which is what lets one deployment
 * serve both.
 *
 * It deliberately has **no link to the app.** This deployment runs one person's
 * instance, and the app sits behind an unlisted path that requires signing in —
 * a page that helpfully advertised it would undo both. Nothing here links out,
 * and the copy below says so rather than teasing a button that is not there.
 *
 * It is a server component: no interactivity, so nothing to hydrate, and the
 * whole page is one HTML response.
 */

const FEATURES = [
  {
    title: "Free, and it stays that way",
    body: "No subscription, no adverts, no upsell screen at the end of a track. There is no paid tier to unlock and no account wall.",
  },
  {
    title: "No account needed",
    body: "Playlists, history and settings live on your device and work immediately. Signing in is optional and only exists so a library can follow you between devices.",
  },
  {
    title: "Radio, podcasts and links",
    body: "SomaFM's stations, shows pulled from YouTube, and any Deezer or SoundCloud link pasted into the search box.",
  },
  {
    title: "Yours to shape",
    body: "Library folders, a sleep timer, crossfade, ducking under speech, and loudness normalisation so a quiet radio station does not blow out next to a loud album.",
  },
];

const SOURCES = ["YouTube", "Deezer", "SomaFM radio", "SoundCloud"];

export default function LandingPage() {
  return (
    <main className="min-h-dvh bg-base">
      {/* Hero */}
      <section className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-24 pb-20 text-center sm:pt-32">
        <span className="mb-8 flex size-16 items-center justify-center rounded-full bg-spotify text-black">
          <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
          </svg>
        </span>

        <h1 className="text-4xl font-bold tracking-tight text-on sm:text-5xl">
          A music player
          <br />
          that asks for nothing.
        </h1>

        <p className="mt-6 max-w-xl text-read leading-relaxed text-sub">
          Free, ad-free, and usable without an account. Plays from{" "}
          {SOURCES.slice(0, -1).join(", ")} and {SOURCES[SOURCES.length - 1]}, in an interface
          shaped like the one you already know.
        </p>

        {/*
          No call to action, on purpose. This deployment is one person's private
          instance; the player is at an unlisted address and requires signing in.
          Putting a button here would advertise it to exactly the wrong audience.
        */}
        <p className="mt-10 max-w-md text-sm leading-relaxed text-dim">
          This is a private instance. There is no public download and no sign-up link on this page.
        </p>
      </section>

      {/* Sources */}
      <section aria-label="Sources" className="border-y border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-6 py-6">
          {SOURCES.map((s) => (
            <span key={s} className="text-label font-semibold text-dim">
              {s}
            </span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section aria-label="What it does" className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="mb-10 text-title font-bold tracking-tight text-on">What it does</h2>
        <div className="grid gap-px overflow-hidden rounded-card bg-line sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-base p-6 sm:p-8">
              <h3 className="text-read font-semibold text-on">{f.title}</h3>
              <p className="mt-2 text-body leading-relaxed text-sub">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-6 py-8">
          <p className="text-micro text-dim">
            muscify — open source, MIT licensed. Not affiliated with Spotify AB.
          </p>
          <a
            href="https://github.com/arjav1181/muscify"
            className="text-micro font-semibold text-sub underline underline-offset-4 transition hover:text-on"
          >
            Source on GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}