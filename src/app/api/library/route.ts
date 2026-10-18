import "server-only";

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getAuthStore, getStore } from "@/lib/persistence/server-store";
import type { PostgresStore } from "@/lib/persistence/postgres-store";
import { SNAPSHOT_VERSION, type LibrarySnapshot } from "@/lib/persistence/types";

/**
 * Library sync, for signed-in listeners and anonymous ones.
 *
 * The only place the sync backend is touched. It answers 501 when no backend is
 * configured, which is the signal the client uses to stop asking — so a
 * deployment with no database variables costs one request at boot and nothing
 * after.
 *
 * There are two kinds of caller and they are kept strictly apart:
 *
 *  - **Signed in.** The user id comes from the verified session and nothing
 *    else. Rows live in `muscify_user_library`.
 *  - **Anonymous.** A random device id in a header. Rows live in
 *    `muscify_library`.
 *
 * The rule that makes this safe: **when a session is present the device header
 * is not read at all.** Not preferred, not validated, not used as a fallback —
 * ignored. A caller signed in as Alice cannot reach Bob's library by pasting
 * his device id into a header, because the header is not consulted. Falling back
 * to it "when there's no account" is the exact bug that would make this
 * endpoint a way to read anyone else's library, so the fallback exists only in
 * the branch where there is genuinely no session at all.
 *
 * Adoption of a device library into an account is deliberately NOT done here.
 * The client decides that, visibly, in the person's hands — this route only
 * ever reads and writes the one row the caller is entitled to.
 */

// No `runtime` export: the Node runtime is the default in this Next version and
// the edge runtime is deprecated, so saying so would only add a line to remove.
// Sync is background work. A hung database must not hold a request open
// indefinitely, so the route's own timeout is well under the platform's.
export const maxDuration = 10;

const DEVICE_HEADER = "x-muscify-device";
/** Upper bound on a stored snapshot, to reject a runaway or hostile payload. */
const MAX_BYTES = 4 * 1024 * 1024;

/** Which row this request may touch, and how. */
type Owner =
  | { kind: "user"; store: PostgresStore; id: string }
  | { kind: "device"; store: NonNullable<ReturnType<typeof getStore>>; id: string }
  | { kind: "none" }
  /** Configured, but the caller did not identify itself. */
  | { kind: "bad-request"; reason: string };

/**
 * Resolves who is calling.
 *
 * Session first and unconditionally. The device header is consulted only when
 * there is no session *and* an anonymous backend exists.
 */
async function resolveOwner(req: Request): Promise<Owner> {
  if (auth) {
    const session = await auth();
    const userId = session?.user?.id;
    if (typeof userId === "string" && userId) {
      const store = getAuthStore();
      // Signed in but no database configured: fall through to the anonymous
      // path rather than erroring, so a partial deployment still works.
      if (store) return { kind: "user", store, id: userId };
    }
  }

  const store = getStore();
  if (!store) return { kind: "none" };

  const device = readDeviceId(req);
  if ("error" in device) return { kind: "bad-request", reason: device.error };
  return { kind: "device", store, id: device.id };
}

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

/**
 * The clock the client compares against.
 *
 * This is the writing device's own stamp, not the database's `now()`. It has to
 * be: the client decides whether the server copy is newer by comparing it with
 * its own stamp, and if the two were different clocks a device running behind
 * would see every pull as "newer than local" and overwrite its own newer edits
 * on every reconnect. Keeping it end-to-end client-supplied means
 * last-write-wins means one thing, even if that thing is "the device whose clock
 * is furthest ahead wins" — which is stated in the README rather than hidden.
 */
function sentStamp(row: { snapshot?: LibrarySnapshot; updated_at: string }): number {
  const sent = typeof row.snapshot?.updatedAt === "number" ? row.snapshot.updatedAt : null;
  const stamp = sent ?? Date.parse(row.updated_at) ?? 0;
  return Number.isFinite(stamp) ? stamp : 0;
}

/** Reads this caller's row, whichever kind of caller they are. */
async function readOwned(
  owner: Exclude<Owner, { kind: "none" | "bad-request" }>,
): Promise<{ version: number; snapshot: LibrarySnapshot; updated_at: string } | null> {
  return owner.kind === "user"
    ? owner.store.readUser(owner.id)
    : owner.store.read(owner.id);
}

async function writeOwned(
  owner: Exclude<Owner, { kind: "none" | "bad-request" }>,
  snapshot: LibrarySnapshot,
): Promise<void> {
  return owner.kind === "user"
    ? owner.store.writeUser(owner.id, snapshot)
    : owner.store.write(owner.id, snapshot);
}

async function removeOwned(
  owner: Exclude<Owner, { kind: "none" | "bad-request" }>,
): Promise<void> {
  return owner.kind === "user"
    ? owner.store.removeUser(owner.id)
    : owner.store.remove(owner.id);
}

/** Maps an unresolved owner onto the right status. */
function refuse(owner: Owner) {
  if (owner.kind === "bad-request") {
    return NextResponse.json({ ok: false, reason: owner.reason }, { status: 400 });
  }
  return NOT_CONFIGURED();
}

export async function GET(req: Request) {
  const owner = await resolveOwner(req);
  if (owner.kind === "none" || owner.kind === "bad-request") return refuse(owner);

  try {
    const row = await readOwned(owner);
    const backend = owner.kind === "user" ? "account" : owner.store.name;

    if (!row) {
      // No row yet means "nothing on the server", not an error. 200 with an
      // empty body is what lets the client tell it apart from a failure.
      return NextResponse.json({ ok: true, backend, scope: owner.kind, snapshot: null });
    }

    return NextResponse.json({
      ok: true,
      backend,
      scope: owner.kind,
      snapshot: { ...row.snapshot, updatedAt: sentStamp(row) },
    });
  } catch (e) {
    console.error("[muscify] sync read failed", e);
    return NextResponse.json({ ok: false, reason: "read failed" }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const owner = await resolveOwner(req);
  if (owner.kind === "none" || owner.kind === "bad-request") return refuse(owner);

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
    await writeOwned(owner, snapshot);
    return NextResponse.json({
      ok: true,
      backend: owner.kind === "user" ? "account" : owner.store.name,
      scope: owner.kind,
      at: Date.now(),
    });
  } catch (e) {
    console.error("[muscify] sync write failed", e);
    return NextResponse.json({ ok: false, reason: "write failed" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const owner = await resolveOwner(req);
  if (owner.kind === "none" || owner.kind === "bad-request") return refuse(owner);

  try {
    await removeOwned(owner);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[muscify] sync delete failed", e);
    return NextResponse.json({ ok: false, reason: "delete failed" }, { status: 502 });
  }
}
