"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CloudOff,
  Cloudy,
  Download,
  Gauge,
  HardDrive,
  Loader2,
  Mic2,
  Music2,
  Palette,
  Radio as RadioIcon,
  ShieldHalf,
  Trash2,
} from "lucide-react";
import { describeNormalization } from "@/lib/audio/normalize";
import { useLibrary } from "@/store/library-store";
import { useUi } from "@/store/ui-store";
import { MAX_SEARCH_HISTORY } from "@/lib/persistence/types";

/**
 * Settings — the "Profile / Settings" primary destination from the product
 * spec.
 *
 * Every preference is grouped by what it affects, and each control states its
 * real scope. Several of these (normalisation, the taste filters) genuinely
 * apply to fewer sources than the name suggests, and saying so here is better
 * than letting someone find out when a track sounds wrong.
 */

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Music2;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <Icon className="h-4 w-4 text-muted" aria-hidden />
        {title}
      </h2>
      {description ? <p className="mb-3 text-xs text-muted">{description}</p> : null}
      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-on">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A switch built from a real checkbox, so it is focusable and form-native. */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? "bg-spotify" : "bg-highlight"
        } peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-white`}
      >
        <span
          className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
      <span className="sr-only">{label}</span>
    </label>
  );
}

function Slider({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="mus-range w-36 accent-spotify"
      />
      <span className="w-14 text-right text-xs tabular-nums text-muted">
        {value}
        {suffix ?? ""}
      </span>
    </div>
  );
}

export function SettingsView() {
  const settings = useLibrary((s) => s.settings);
  const update = useLibrary((s) => s.updateSettings);
  const durable = useLibrary((s) => s.durable);
  const syncStatus = useLibrary((s) => s.syncStatus);
  const syncState =
    syncStatus === "syncing"
      ? "syncing"
      : syncStatus === "synced"
        ? "synced"
        : syncStatus === "off"
          ? "off"
          : "local";
  const reset = useLibrary((s) => s.reset);
  const taste = useLibrary((s) => s.taste);
  const searchHistory = useLibrary((s) => s.searchHistory);
  const clearSearchHistory = useLibrary((s) => s.clearSearchHistory);
  const toast = useUi((s) => s.toast);

  const [confirmingReset, setConfirmingReset] = useState(false);

  const plays = taste.plays.length;
  const hidden = taste.hidden.length;
  const snoozed = taste.snoozed.length;

  /**
   * Exports everything as JSON.
   *
   * This is the escape hatch for a localStorage-only library: without it,
   * clearing site data is unrecoverable. It also makes the privacy claim
   * checkable — the file is exactly what is stored.
   */
  const exportData = () => {
    const snapshot = {
      version: 2,
      exportedAt: new Date().toISOString(),
      catalog: useLibrary.getState().catalog,
      playlists: useLibrary.getState().playlists,
      liked: useLibrary.getState().liked,
      recentlyPlayed: useLibrary.getState().recentlyPlayed,
      followedArtists: useLibrary.getState().followedArtists,
      followedPlaylists: useLibrary.getState().followedPlaylists,
      searchHistory,
      settings,
      taste,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `muscify-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Library exported", "success");
  };

  return (
    <div className="mx-auto max-w-3xl px-2 py-8">
      <h1 className="mb-1 text-3xl font-bold tracking-tight text-on">Settings</h1>
      <p className="mb-8 text-sm text-sub">
        Everything here is stored in this browser. Nothing is uploaded, and there is no account.
      </p>

      <Section icon={Music2} title="Playback">
        <Row label="Autoplay next track" hint="Continue when the queue finishes">
          <Toggle
            checked={settings.autoplay}
            onChange={(v) => update({ autoplay: v })}
            label="Autoplay next track"
          />
        </Row>
        <Row
          label="Autoplay similar tracks"
          hint="Queue recommendations when the queue runs dry, honouring what you have hidden and snoozed"
        >
          <Toggle
            checked={settings.autoplaySimilar}
            onChange={(v) => update({ autoplaySimilar: v })}
            label="Autoplay similar tracks"
          />
        </Row>
        <Row label="Pause when you switch tabs" hint="Stops playing when this tab is hidden">
          <Toggle
            checked={settings.pauseOnBlur}
            onChange={(v) => update({ pauseOnBlur: v })}
            label="Pause when you switch tabs"
          />
        </Row>
        <Row label="Sleep timer default" hint="Pre-selected minutes when you open the sleep timer">
          <Slider
            value={settings.sleepTimerMinutes}
            min={0}
            max={120}
            step={5}
            suffix=" min"
            onChange={(v) => update({ sleepTimerMinutes: v })}
            label="Sleep timer default in minutes"
          />
        </Row>
      </Section>

      <Section
        icon={RadioIcon}
        title="Sound"
        description="Crossfade fades each track out near its end, then back in on the next. It is a volume ramp, not an overlap — the embeds cannot be played simultaneously."
      >
        <Row label="Crossfade" hint="Seconds of fade at the end of each track">
          <Slider
            value={settings.crossfadeSeconds}
            min={0}
            max={12}
            suffix="s"
            onChange={(v) => update({ crossfadeSeconds: v })}
            label="Crossfade seconds"
          />
        </Row>
        <Row label="Fade out length" hint="How long the fade itself takes">
          <Slider
            value={settings.fadeOutSeconds}
            min={0}
            max={10}
            step={0.5}
            suffix="s"
            onChange={(v) => update({ fadeOutSeconds: v })}
            label="Fade out seconds"
          />
        </Row>
        <Row label="Loudness normalisation" hint={describeNormalization()}>
          <Toggle
            checked={settings.normaliseLoudness}
            onChange={(v) => update({ normaliseLoudness: v })}
            label="Loudness normalisation"
          />
        </Row>
        <Row label="Equalizer" hint="10-band EQ, applied to radio streams">
          <span className="rounded-full border border-line-strong px-3 py-1 text-xs text-muted">
            Player bar
          </span>
        </Row>
      </Section>

      <Section
        icon={ShieldHalf}
        title="Privacy and safety"
        description="These change what recommendations can show you. None of them deletes your history."
      >
        <Row
          label="Private Session"
          hint="Keep listening out of your stats and recommendations. Plays are still recorded so your history stays intact."
        >
          <Toggle
            checked={settings.privateSession}
            onChange={(v) => update({ privateSession: v })}
            label="Private Session"
          />
        </Row>
        <Row label="Hide explicit tracks" hint="Skip anything marked explicit before it is queued">
          <Toggle
            checked={settings.excludeExplicit}
            onChange={(v) => update({ excludeExplicit: v })}
            label="Hide explicit tracks"
          />
        </Row>
        <Row label="Show Hide and Snooze controls" hint="Adds them to every track menu">
          <Toggle
            checked={settings.tasteControls}
            onChange={(v) => update({ tasteControls: v })}
            label="Show Hide and Snooze controls"
          />
        </Row>
        <Row label="Your data" hint={`${plays} plays recorded · ${hidden} hidden · ${snoozed} snoozed`}>
          <Link
            href="/stats"
            className="rounded-full border border-line-strong px-3 py-1 text-xs text-muted hover:text-on"
          >
            View stats
          </Link>
        </Row>
      </Section>

      <Section icon={Mic2} title="Lyrics">
        <Row label="Load lyrics" hint="Looks them up when a track starts">
          <Toggle
            checked={settings.lyricsEnabled}
            onChange={(v) => update({ lyricsEnabled: v })}
            label="Load lyrics"
          />
        </Row>
        <Row
          label="Word-by-word highlight"
          hint="Interpolated from line timestamps, not forced-aligned — see the note in the lyrics panel"
        >
          <Toggle
            checked={settings.karaokeLyrics}
            onChange={(v) => update({ karaokeLyrics: v })}
            label="Word-by-word highlight"
          />
        </Row>
      </Section>

      <Section icon={Palette} title="Appearance">
        <Row label="Compact rows" hint="Denser lists, more on screen at once">
          <Toggle
            checked={settings.compactMode}
            onChange={(v) => update({ compactMode: v })}
            label="Compact rows"
          />
        </Row>
      </Section>

      <Section icon={Gauge} title="Your data">
        <Row
          label="Export library"
          hint={
            durable
              ? "Downloads every playlist, like and setting as JSON"
              : "Storage is unavailable in this browser, so there is nothing to export yet"
          }
        >
          <button
            type="button"
            onClick={exportData}
            disabled={!durable}
            className="inline-flex items-center gap-2 rounded-full border border-line-strong px-3 py-1 text-xs text-on transition hover:border-white/40 disabled:opacity-40"
          >
            <Download size={13} aria-hidden />
            Export
          </button>
        </Row>
        <Row
          label={`Search history (${searchHistory.length}/${MAX_SEARCH_HISTORY})`}
          hint="Queries you have submitted, stored locally"
        >
          <button
            type="button"
            onClick={() => {
              clearSearchHistory();
              toast("Search history cleared", "success");
            }}
            disabled={searchHistory.length === 0}
            className="rounded-full border border-line-strong px-3 py-1 text-xs text-on transition hover:border-white/40 disabled:opacity-40"
          >
            Clear
          </button>
        </Row>
        {!durable ? (
          <Row
            label="Storage unavailable"
            hint="Private browsing or a full quota. Your library is kept in memory and will be lost on reload."
          >
            <AlertTriangle size={16} className="text-amber-400" aria-hidden />
          </Row>
        ) : null}

        {/*
          Sync has to be visible to be believable. A library that silently
          failed to sync looks identical to one that works, and the listener
          cannot tell which — so this reports what actually happened rather than
          showing an optimistic "synced" that was never verified.
        */}
        <Row
          label="Sync across devices"
          hint={
            syncState === "syncing"
              ? "Checking the server for changes."
              : syncState === "synced"
                ? "Up to date. Your library follows you between browsers on this account-less device id."
                : syncState === "off"
                  ? "Not configured on this deployment. Your library is stored in this browser only, and clearing site data will lose it."
                  : syncStatus === "unreachable"
                    ? "The sync server did not answer, so changes are being kept in this browser only until it does."
                    : "Storage only. Nothing has been sent anywhere."
          }
        >
          {syncState === "syncing" ? (
            <Loader2 size={15} className="animate-spin text-muted" aria-hidden />
          ) : syncState === "synced" ? (
            <Cloudy size={16} className="text-green-400" aria-hidden />
          ) : syncState === "off" ? (
            <CloudOff size={16} className="text-muted" aria-hidden />
          ) : (
            <HardDrive size={16} className="text-muted" aria-hidden />
          )}
          <span className="sr-only">
            {syncState === "synced"
              ? "Synced"
              : syncState === "syncing"
                ? "Syncing"
                : syncState === "off"
                  ? "Not configured"
                  : "This browser only"}
          </span>
        </Row>
        <Row
          label="Delete everything"
          hint="Removes all playlists, likes, history and settings from this browser. This cannot be undone."
        >
          {confirmingReset ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void reset();
                  setConfirmingReset(false);
                  toast("Library deleted", "success");
                }}
                className="rounded-full bg-red-500 px-3 py-1 text-xs font-medium text-white"
              >
                Yes, delete it
              </button>
              <button
                type="button"
                onClick={() => setConfirmingReset(false)}
                className="rounded-full border border-line-strong px-3 py-1 text-xs text-muted hover:text-on"
              >
                  Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              className="inline-flex items-center gap-2 rounded-full border border-red-500/50 px-3 py-1 text-xs text-red-300 transition hover:bg-red-500/10"
            >
              <Trash2 size={13} aria-hidden />
              Delete
            </button>
          )}
        </Row>
      </Section>

      <p className="text-xs text-muted">
        muscify plays from YouTube, Deezer, SoundCloud and radio directories. It is free, has no
        ads, and is not affiliated with Spotify.
      </p>
    </div>
  );
}
