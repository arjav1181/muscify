"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Clock, Disc3, Headphones, Mic2, Timer, TrendingUp } from "lucide-react";
import { computeStats, summarise } from "@/lib/taste/stats";
import { useLibrary } from "@/store/library-store";

/**
 * Listening stats.
 *
 * Every number here comes from the local play log, and every number excludes
 * Private Session listens — the stats page states that rather than quietly
 * omitting it, so a listener who used the feature knows why the totals look
 * lower than they remember.
 *
 * This is not Spotify's "listening stats" (a server-side weekly recap across
 * every device). It can only be as good as the history recorded here.
 */

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-dim">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

/** Peak hour plus its share of plays, described in the listener's own clock. */
function peakHourLabel(byHour: number[]): string | null {
  const total = byHour.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let best = 0;
  for (let h = 1; h < 24; h++) if (byHour[h] > byHour[best]) best = h;
  const suffix = best < 12 ? "am" : "pm";
  const hour12 = best % 12 === 0 ? 12 : best % 12;
  return `${hour12}${suffix} · ${Math.round((byHour[best] / total) * 100)}% of plays`;
}

function HourChart({ byHour }: { byHour: number[] }) {
  const peak = Math.max(...byHour, 1);
  return (
    <div className="flex h-24 items-end gap-[2px]" role="img" aria-label="Plays by hour of day">
      {byHour.map((count, hour) => (
        <div
          key={hour}
          className="flex-1 rounded-t bg-white/25 transition-[height]"
          style={{ height: `${Math.max(2, (count / peak) * 100)}%` }}
          title={`${hour}:00 — ${count} play${count === 1 ? "" : "s"}`}
        />
      ))}
    </div>
  );
}

export function StatsView() {
  const plays = useLibrary((s) => s.taste.plays);
  const catalog = useLibrary((s) => s.catalog);
  const settings = useLibrary((s) => s.settings);

  const stats = useMemo(
    () =>
      computeStats(plays, (key) => {
        const entry = catalog[key];
        if (!entry) return undefined;
        return {
          artist: entry.track.artist,
          durationMs: entry.track.duration ? entry.track.duration * 1000 : undefined,
        };
      }),
    [plays, catalog],
  );

  const peak = peakHourLabel(stats.byHour);

  if (stats.plays === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <Headphones className="mx-auto h-10 w-10 text-muted" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold">No listening stats yet</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-dim">
          Stats build from tracks you play for more than 30 seconds. Nothing is uploaded —
          this is computed from a play log kept in your browser.
        </p>
        {settings.privateSession ? (
          <p className="mt-4 text-sm text-amber-300/80">
            Private Session is on, so new listens are being kept out of these numbers.
          </p>
        ) : null}
        <Link
          href="/discover"
          className="mt-6 inline-block rounded-full bg-white px-5 py-2 text-sm font-medium text-black"
        >
          Find something to play
        </Link>
      </div>
    );
  }

  const rowFor = (key: string) => catalog[key]?.track;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Listening stats</h1>
        <p className="mt-1 text-sm text-dim">
          {summarise(stats)} · computed locally from your play log
        </p>
        {settings.privateSession ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1 text-xs text-amber-200">
            Private Session is on — listens made while it was active are excluded
          </p>
        ) : null}
        {stats.privateExcluded > 0 ? (
          <p className="mt-2 text-xs text-muted">
            {stats.privateExcluded} private listen{stats.privateExcluded === 1 ? "" : "s"} excluded.
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={Clock} label="Listened" value={formatDuration(stats.totalMs)} />
        <StatTile icon={Disc3} label="Plays" value={stats.plays.toLocaleString()} />
        <StatTile icon={Mic2} label="Artists" value={String(stats.uniqueArtists)} hint={`${stats.uniqueTracks} tracks`} />
        <StatTile
          icon={TrendingUp}
          label="Finished"
          value={stats.completion ? `${Math.round(stats.completion * 100)}%` : "—"}
          hint="of known-duration tracks"
        />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Timer className="h-4 w-4 text-dim" aria-hidden />
          When you listen
          {peak ? <span className="text-sm font-normal text-dim">peak {peak}</span> : null}
        </h2>
        <HourChart byHour={stats.byHour} />
        <div className="mt-1 flex justify-between text-[10px] text-muted">
          <span>12am</span>
          <span>6am</span>
          <span>12pm</span>
          <span>6pm</span>
          <span>11pm</span>
        </div>
      </section>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Top artists</h2>
          <ol className="space-y-1">
            {stats.topArtists.slice(0, 10).map((artist, i) => (
              <li
                key={artist.name}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-white/5"
              >
                <span className="w-5 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{artist.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {formatDuration(artist.ms)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Most played</h2>
          <ol className="space-y-1">
            {stats.topTracks.slice(0, 10).map((track, i) => {
              const meta = rowFor(track.key);
              return (
                <li key={track.key} className="rounded-md px-2 py-1.5 hover:bg-white/5">
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{meta?.title ?? track.key}</span>
                      <span className="block truncate text-xs text-muted">
                        {meta?.artist ?? "unknown artist"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {track.plays}×
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Daily listening</h2>
        {stats.byDay.length === 0 ? (
          <p className="text-sm text-dim">No daily data.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {[...stats.byDay].reverse().slice(0, 14).map((day) => (
              <li key={day.day} className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-white/5">
                <span className="w-28 shrink-0 tabular-nums text-dim">{day.day}</span>
                <span
                  className="h-1.5 rounded-full bg-white/40"
                  style={{
                    width: `${Math.max(4, (day.ms / Math.max(...stats.byDay.map((d) => d.ms))) * 100)}%`,
                  }}
                />
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
                  {formatDuration(day.ms)} · {day.plays}×
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-xs text-muted">
        This is your own history on this device, not a cross-device recap. Nothing here leaves
        your browser.
      </p>
    </div>
  );
}