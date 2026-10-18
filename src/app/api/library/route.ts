import "server-only";

import { NextResponse } from "next/server";

import { getStore } from "@/lib/persistence/server-store";
import { SNAPSHOT_VERSION, type LibrarySnapshot } from "@/lib/persistence/types";

/**
 * Optional library sync.
 *
 * The only place the sync backend is touched. It answers 501 when no backend is
 * configured, which is the signal the client uses to stop asking — so a
 * deployment with no database variables costs one request at boot and nothing
 * after.
 *
 * Identity is a random device id supplied by the caller in a header. There is
 * no account system and no credential in the request, so this endpoint cannot
 * be used to read or overwrite anyone's library by guessing an id: ids are 122
 * bits of UUIDv4 and are never transmitted anywhere but to this route.
 *
 * That is a deliberate trade, not an oversight. It makes sync opt-in and
 * credential-free, and in exchange there is no way to recover a library if the
 * browser's localStorage is cleared. Adding accounts later means adding a real
 * auth layer in front of this route and keying rows by user; the storage
 * interface below is already shaped for that change.
 *
 * A real user id must NOT simply be substituted for the device header when that
 * day comes. What exists today is implicit authorisation by possession of a
 * 122-bit unguessable id — the weakest thing that can honestly be called
 * authorisation. Adding a real identity means adding real checks, not renaming
 * the existing one.
 */

// No `runtime` export: the Node runtime is the default in this Next version and
// the edge runtime is deprecated, so saying so would only add a line to remove.
// Sync is background work. A hung database must not hold a request open
// indefinitely, so the route's own timeout is well under the platform's.
export const maxDuration = 10;

const DEVICE_HEADER = "x-muscify-device";
/** Upper bound on a stored snapshot, to reject a runaway or hostile payload. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Reads and validates the caller's device id.
 *
 * Returns a reason string rather than throwing so each caller can answer with
 * the status that matches: a missing header is the caller's bug (400) while an
 * over-long one is hostile input (400 as well, but worded differently in logs).
 */
function readDeviceId(req: Request): { id: string } | { error: string; status: number } {
  const raw = req.headers.get(DEVICE_HEADER);
  if (!raw) return { error: "missing device id", status: 400 };
  // UUIDv4 and the `d_`-prefixed fallback this client generates for private
  // mode. Anything else is not something we issued.
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(raw)) return { error: "malformed device id", status: 400 };
  return { id: raw };
}

const NOT_CONFIGURED = () =>
  NextResponse.json(
    { ok: false, reason: "sync is not configured on this deployment" },
    { status: 501 },
  );

export async function GET(req: Request) {
  const store = getStore();
  if (!store) return NOT_CONFIGURED();

  const device = readDeviceId(req);
  if ("error" in device) {
    return NextResponse.json({ ok: false, reason: device.error }, { status: device.status });
  }

  try {
    const row = await store.read(device.id);
    if (!row) {
      // No row yet means "nothing on the server", not an error. 200 with an
      // empty object is what lets the client distinguish it from a failure.
      return NextResponse.json({ ok: true, backend: store.name, snapshot: null });
    }

    // The clock handed back is the one the writing device sent, not the
    // database's `now()`. This matters: the client compares this against its own
    // stamp to decide whether the server copy is newer, and the two must be the
    // same clock or a device running behind will see every pull as "newer than
    // local" and overwrite its own newer edits on every reconnect. Keeping it
    // end-to-end client-supplied makes last-write-wins mean one thing, even if
    // that thing is "the device whose clock is furthest ahead wins" — which is
    // stated in the README rather than hidden.
    const sent = typeof row.snapshot?.updatedAt === "number" ? row.snapshot.updatedAt : null;
    const stamp = sent ?? Date.parse(row.updated_at) ?? 0;

    return NextResponse.json({
      ok: true,
      backend: store.name,
      snapshot: { ...row.snapshot, updatedAt: Number.isFinite(stamp) ? stamp : 0 },
    });
  } catch (e) {
    console.error("[muscify] sync read failed", e);
    return NextResponse.json({ ok: false, reason: "read failed" }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const store = getStore();
  if (!store) return NOT_CONFIGURED();

  const device = readDeviceId(req);
  if ("error" in device) {
    return NextResponse.json({ ok: false, reason: device.error }, { status: device.status });
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json({ ok: false, reason: "unreadable body" }, { status: 400 });
  }

  if (body.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, reason: "snapshot too large" }, { status: 413 });
  }

  let snapshot: LibrarySnapshot;
  try {
    snapshot = JSON.parse(body) as LibrarySnapshot;
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid JSON" }, { status: 400 });
  }

  // Version is checked rather than trusted. A snapshot from a future build may
  // contain fields this one does not understand, and writing it would then have
  // the newer client overwrite newer data with older data on the way back down.
  if (typeof snapshot?.version !== "number" || snapshot.version > SNAPSHOT_VERSION) {
    return NextResponse.json({ ok: false, reason: "unsupported snapshot version" }, { status: 409 });
  }

  try {
    await store.write(device.id, snapshot);
    return NextResponse.json({ ok: true, backend: store.name, at: Date.now() });
  } catch (e) {
    console.error("[muscify] sync write failed", e);
    return NextResponse.json({ ok: false, reason: "write failed" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const store = getStore();
  if (!store) return NOT_CONFIGURED();

  const device = readDeviceId(req);
  if ("error" in device) {
    return NextResponse.json({ ok: false, reason: device.error }, { status: device.status });
  }

  try {
    await store.remove(device.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[muscify] sync delete failed", e);
    return NextResponse.json({ ok: false, reason: "delete failed" }, { status: 502 });
  }
}