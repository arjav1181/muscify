"use client";

import { LocalLibraryRepository, migrate } from "./local.ts";
import type { LibraryRepository, LibrarySnapshot } from "./types.ts";

/**
 * Optional server sync.
 *
 * The backend is opt-in, so nothing here may become a precondition for the app
 * working. The design rule throughout: localStorage stays the source of truth,
 * and the server is a mirror that makes the library follow you between devices.
 *
 * That ordering is deliberate and not a shortcut:
 *
 *  - Reads never touch the network. A library app that shows a spinner on cold
 *    start because a Postgres round trip is in flight is worse than one that
 *    shows your playlists instantly and catches up a moment later.
 *  - Writes go to local first and remote second. A failed or slow upload costs
 *    cross-device sync, not the change the listener just made.
 *  - Losing the network loses sync, not data. Offline is the normal case for a
 *    music player on a phone, and it must not be a degraded one.
 *
 * Anonymous by design. There is no account, no email and no personal data: a
 * random device id stored locally is the only identifier, and it is what rows
 * are keyed by. That is enough to sync a browser's library to another browser
 * and deliberately not enough to identify anyone.
 */

/** Header carrying the generated device id. */
const DEVICE_HEADER = "x-muscify-device";

/** How long the server gets before boot gives up on it and carries on. */
const SYNC_TIMEOUT_MS = 6_000;

function deviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Resolves the device id, creating one on first run.
 *
 * Kept out of localStorage on purpose. If it lived in the library payload then
 * `clear()` — "delete everything" — would also destroy the key the next sync
 * needs, and the device would silently fork a new identity.
 */
function resolveDeviceId(): string {
  const KEY = "muscify:device";
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = deviceId();
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private mode. A per-session id still syncs within the tab.
    return deviceId();
  }
}

/**
 * Epoch ms of a snapshot's last write.
 *
 * Only present once sync is in play; local-only snapshots have no clock, and
 * `0` compares as older than anything, so a device that has never synced is
 * always the one whose copy is replaced.
 */
function stampedAt(snapshot: LibrarySnapshot): number {
  return snapshot.updatedAt ?? 0;
}

/**
 * Conflict resolution is last-write-wins on the *client's* clock.
 *
 * Honest about what that is: there is no server-side vector clock and no
 * revision history, so two devices editing offline and syncing later resolve
 * to whichever wrote last, and a device whose clock is badly wrong can win or
 * lose. That is a deliberate ceiling for an anonymous, account-free backend —
 * real merge semantics need real identities, and adding those is the change
 * that should also add CRDTs rather than smuggling them in here.
 */
function stamp(snapshot: LibrarySnapshot): LibrarySnapshot {
  return { ...snapshot, updatedAt: Date.now() };
}

/**
 * Outcome of one sync attempt.
 *
 * The distinction between "off" and "unreachable" is the whole point. A
 * deployment with no backend is a fact; a backend that is down is a fault, and
 * collapsing them would mean telling every user their library is unsynced when
 * in fact the feature was never switched on.
 */
export type SyncOutcome =
  /** The server answered. `snapshot` is non-null only when one was adopted. */
  | {
      status: "synced";
      snapshot: LibrarySnapshot | null;
      /** Who the server thinks we are. Absent when the server is anonymous-only. */
      scope?: "user" | "device";
    }
  /** No backend is configured on this deployment. A fact, not a fault. */
  | { status: "off" }
  /** Configured but not answering. A fault worth showing as one. */
  | { status: "unreachable"; reason: string };

/**
 * Whether a library has anything worth moving to an account.
 *
 * An account should not adopt an empty library: it would create a server row
 * that then always wins over a device that later builds up a real one, which is
 * the clobber this is meant to prevent.
 */
function hasContent(snapshot: LibrarySnapshot): boolean {
  return (
    snapshot.playlists.length > 0 ||
    snapshot.liked.length > 0 ||
    Object.keys(snapshot.catalog).length > 0
  );
}

/**
 * Local repository with a best-effort server mirror.
 *
 * Reports `durable` from whichever half is actually usable, so the UI's
 * "your library is only saved on this device" warning reflects reality: a
 * configured server with a broken connection is not durable, and neither is a
 * browser refusing localStorage.
 */
export class SyncingLibraryRepository implements LibraryRepository {
  private local: LibraryRepository;
  private device: string;
  /** False until the server has answered at least once. */
  private remoteReachable = false;
  /** Set once the server says it is not configured, so it is never asked again. */
  private remoteDisabled = false;
  private online = typeof navigator === "undefined" ? true : navigator.onLine;

  constructor() {
    this.local = new LocalLibraryRepository();
    this.device = resolveDeviceId();

    // While the tab is offline every request would fail after a timeout.
    // Listening avoids the queue of doomed fetches.
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        this.online = true;
      });
      window.addEventListener("offline", () => {
        this.online = false;
      });
    }
  }

  get durable(): boolean {
    return this.local.durable && this.remoteReachable;
  }

  /** Local only. Never blocks on the network. */
  async load(): Promise<LibrarySnapshot> {
    return this.local.load();
  }

  async save(snapshot: LibrarySnapshot): Promise<void> {
    // Stamped before the local write so the very next pull compares against
    // this change rather than against the snapshot we were pulled from.
    const stamped = stamp(snapshot);
    await this.local.save(stamped);
    void this.push(stamped);
  }

  async clear(): Promise<void> {
    await this.local.clear();
    void this.request("DELETE");
  }

  /**
   * Fetches the server copy and adopts it when it is newer.
   *
   * Called after boot rather than inside `load()` so the library renders
   * immediately and updates when the answer arrives.
   */
  async pull(): Promise<SyncOutcome> {
    if (this.remoteDisabled) return { status: "off" };
    if (!this.online) return { status: "unreachable", reason: "offline" };

    const raw = await this.request("GET");
    if (raw === "disabled") {
      this.remoteDisabled = true;
      return { status: "off" };
    }
    if (raw === null) return { status: "unreachable", reason: "no response" };

    let body: { ok?: boolean; snapshot?: LibrarySnapshot | null; scope?: "user" | "device" };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      console.warn("[muscify] sync response unreadable");
      return { status: "unreachable", reason: "unreadable response" };
    }

    if (!body.ok) return { status: "unreachable", reason: "server refused" };

    this.remoteReachable = true;
    const scope = body.scope;

    const remote = body.snapshot ?? null;
    const local = await this.local.load();

    // No server row for this caller.
    if (!remote) {
      /*
        Adopt, never clobber.
        
        Signed in, the account has nothing, and this device has a library worth
        having: push it up. This is the only path that ever writes a local
        library into an account, and it fires exactly once -- after the push the
        account has a row, so the next boot takes the branch below.
        
        The guard on `hasContent` matters. Without it an account would adopt an
        empty library from a device that had just installed the app, and that
        empty row would then outrank the real library the device builds later --
        which is precisely the clobber this is meant to prevent.
        
        If the account already has a row, nothing here runs and last-write-wins
        below applies unchanged. Signing in never discards either copy.
      */
      if (scope === "user" && hasContent(local)) {
        await this.push(local);
        return { status: "synced", snapshot: null, scope };
      }
      return { status: "synced", snapshot: null, scope };
    }

    let normalised: LibrarySnapshot;
    try {
      normalised = migrate(remote);
    } catch {
      // A corrupt server row must not be able to break the app, and must not be
      // silently overwritten either — the next push would destroy whatever the
      // listener has on this device.
      console.warn("[muscify] server library unreadable; keeping the local copy");
      return { status: "synced", snapshot: null, scope };
    }

    if (stampedAt(normalised) <= stampedAt(local)) {
      return { status: "synced", snapshot: null, scope };
    }

    await this.local.save(normalised);
    return { status: "synced", snapshot: normalised, scope };
  }

  /** Uploads without blocking the caller. Failures are expected and ignored. */
  private async push(snapshot: LibrarySnapshot): Promise<void> {
    if (this.remoteDisabled || !this.online) return;
    const body = JSON.stringify(snapshot);
    const ok = await this.request("PUT", body);
    // A 404 is "no server configured", not a transient failure, so it must not
    // be retried on every keystroke for the rest of the session.
    if (ok === "disabled") this.remoteDisabled = true;
    else if (ok) this.remoteReachable = true;
  }

  /**
   * One HTTP round trip to the sync route.
   *
   * Returns the body on success, "disabled" when no backend is configured, or
   * null on any failure. Never throws: sync is a background nicety and an
   * exception here would surface as an unhandled rejection in a React effect.
   */
  private async request(
    method: "GET" | "PUT" | "DELETE",
    body?: string,
  ): Promise<string | "disabled" | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

    try {
      const res = await fetch("/api/library", {
        method,
        headers: {
          [DEVICE_HEADER]: this.device,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body,
        signal: controller.signal,
        cache: "no-store",
      });

      // 501 is the deliberate "no backend configured" signal from the route.
      if (res.status === 501 || res.status === 404) return "disabled";
      if (!res.ok) return null;
      if (method === "DELETE") return "";
      return res.text();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Chooses a repository for this install.
 *
 * Always returns a working one: the syncing repository degrades to plain local
 * storage when the server is absent, so there is no branch here that can leave
 * the app without persistence.
 */
export function createRepository(): LibraryRepository {
  if (typeof window === "undefined") return new LocalLibraryRepository();
  return new SyncingLibraryRepository();
}
