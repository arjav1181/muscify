import type { LibrarySnapshot } from "./types.ts";

/**
 * Server-side storage for the optional sync backend.
 *
 * NOTE: the `server-only` guard lives in the route handler that imports this,
 * not here. That package deliberately throws unless the bundler resolves its
 * `react-server` condition, which plain `node --test` cannot — and the backend
 * selection logic below is exactly the kind of thing that needs tests, since
 * getting it wrong means writing into a database that belongs to something
 * else. The route is the only importer, so the guard still holds.
 *
 * Two supported stores, chosen entirely by environment variables. Neither is
 * required: with no configuration the route answers 501 and the app silently
 * uses local storage, which is the default deployment.
 *
 * Supabase is reached over its PostgREST HTTP API rather than an SDK. The whole
 * surface needed here is one table's upsert and select, and doing it with fetch
 * means the sync feature adds no client library to the bundle at all — which
 * matters for something this optional. Neon has no equivalent HTTP endpoint for
 * SQL, so it uses the official serverless driver, imported dynamically and only
 * when a Neon URL is actually present.
 *
 * Credentials never reach the browser. The route is the only caller and it
 * talks to the database with a service-role key, so the anon key can stay
 * client-side-unused and the table can sit behind row-level security.
 */

/** One row of the sync table. */
interface LibraryRow {
  device_id: string;
  version: number;
  snapshot: LibrarySnapshot;
  updated_at: string;
}

/** Both stores implement this. */
export interface RemoteStore {
  /** Returns null when the device has no row yet. */
  read(deviceId: string): Promise<LibraryRow | null>;
  /** Inserts or replaces the device's row. */
  write(deviceId: string, snapshot: LibrarySnapshot): Promise<void>;
  remove(deviceId: string): Promise<void>;
  /** Identifies the backend in the settings status line. */
  readonly name: "supabase" | "neon";
}

/**
 * A bound value the driver understands. Snapshot is passed as a JSON string and
 * cast in SQL rather than handed over as an object, because Postgres has no
 * JSON type in its text protocol and `jsonb` needs the literal.
 */
const asJson = (snapshot: LibrarySnapshot): string => JSON.stringify(snapshot);

/** PostgREST needs a full URL including scheme; `postgrest.co` is not a host. */
function supabaseUrl(raw: string): string {
  if (!raw) return "";
  return raw.startsWith("http") ? raw.replace(/\/+$/, "") : `https://${raw.replace(/\/+$/, "")}`;
}

/**
 * Supabase over PostgREST.
 *
 * One endpoint serves both operations: `Prefer: resolution=merge-duplicates`
 * with an `on_conflict` key turns a POST into an upsert, which is one request
 * instead of a select-then-branch-then-write.
 */
class SupabaseStore implements RemoteStore {
  readonly name = "supabase" as const;
  private base: string;
  private headers: Record<string, string>;

  constructor(url: string, key: string) {
    this.base = `${url}/rest/v1/muscify_library`;
    this.headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }

  async read(deviceId: string): Promise<LibraryRow | null> {
    const url = `${this.base}?device_id=eq.${encodeURIComponent(deviceId)}&select=*`;
    const res = await fetch(url, { headers: this.headers, cache: "no-store" });
    if (!res.ok) throw new Error(`supabase read failed: ${res.status}`);

    const rows = (await res.json()) as LibraryRow[];
    return rows[0] ?? null;
  }

  async write(deviceId: string, snapshot: LibrarySnapshot): Promise<void> {
    const res = await fetch(this.base, {
      method: "POST",
      headers: {
        ...this.headers,
        // Upsert. Without this a second write for the same device is a 409.
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        device_id: deviceId,
        version: snapshot.version,
        snapshot: asJson(snapshot),
      }),
    });
    if (!res.ok) throw new Error(`supabase write failed: ${res.status}`);
  }

  async remove(deviceId: string): Promise<void> {
    const url = `${this.base}?device_id=eq.${encodeURIComponent(deviceId)}`;
    const res = await fetch(url, { method: "DELETE", headers: this.headers });
    if (!res.ok) throw new Error(`supabase delete failed: ${res.status}`);
  }
}

/** The driver's tagged-template callable, narrowed to what these stores use. */
type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

/**
 * Neon over the official serverless driver.
 *
 * The client is built on first use rather than in the constructor, and memoised
 * after that: the driver pools connections internally, so rebuilding per request
 * would open a new pool on every save. Deferring the import also means a
 * misconfigured deployment cannot produce an unhandled rejection — nothing is
 * loaded until a query is actually about to run.
 */
class NeonStore implements RemoteStore {
  readonly name = "neon" as const;
  private url: string;
  private sqlPromise: Promise<Sql> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  private sql(): Promise<Sql> {
    this.sqlPromise ??= (async () => {
      const { neon } = await import("@neondatabase/serverless");
      return neon(this.url) as unknown as Sql;
    })();
    return this.sqlPromise;
  }

  async read(deviceId: string): Promise<LibraryRow | null> {
    const sql = await this.sql();
    const rows = await sql`
      select device_id, version, snapshot, updated_at
        from muscify_library
       where device_id = ${deviceId}
       limit 1
    `;
    return (rows[0] as LibraryRow | undefined) ?? null;
  }

  async write(deviceId: string, snapshot: LibrarySnapshot): Promise<void> {
    const sql = await this.sql();
    await sql`
      insert into muscify_library (device_id, version, snapshot, updated_at)
      values (${deviceId}, ${snapshot.version}, ${asJson(snapshot)}::jsonb, now())
      on conflict (device_id) do update
        set version = excluded.version,
            snapshot = excluded.snapshot,
            updated_at = now()
    `;
  }

  async remove(deviceId: string): Promise<void> {
    const sql = await this.sql();
    await sql`delete from muscify_library where device_id = ${deviceId}`;
  }
}

/**
 * The schema both backends need.
 *
 * Shipped as a constant rather than applied at runtime: a serverless function
 * that runs DDL on a cold start is a race between concurrent instances, and a
 * failed migration should be visible rather than swallowed. Run it once by
 * hand — or paste it into the Supabase SQL editor — and the app uses it.
 *
 * Row-level security is enabled and no policy is granted to `anon` or
 * `authenticated`. The route uses the service-role key, which bypasses RLS, so
 * the table is unreachable from the browser even if the anon key leaks. The
 * Supabase API also requires the table to be exposed through the `public`
 * schema before PostgREST will serve it:
 *
 *   alter table muscify_library enable row level security;
 *   grant all on muscify_library to service_role;
 */
export const SCHEMA_SQL = `
create table if not exists muscify_library (
  device_id  text primary key,
  version    integer not null,
  snapshot   jsonb   not null,
  updated_at timestamptz not null default now()
);

alter table muscify_library enable row level security;
grant all on muscify_library to service_role;
`;

/** Memoised so a warm lambda reuses one client instead of rebuilding it. */
let cached: RemoteStore | null = null;

/**
 * Which backend to use, if any.
 *
 * Two rules here are load-bearing and both were learned the hard way:
 *
 *  1. `MUSCIFY_*` names are auto-detected. `DATABASE_URL` is deliberately not.
 *     It is one of the most widely-used variable names there is — Vercel
 *     integrations, CI runners and local dev boxes all set it for a database
 *     that has nothing to do with this app. Claiming it means muscify would
 *     create and write a `muscify_library` table inside somebody's unrelated
 *     database. The generic names are honoured only when
 *     `MUSCIFY_SYNC_BACKEND` explicitly names the backend, which is also the
 *     answer for a Vercel-integrated Neon project where the variable is set for
 *     you and renaming it is not practical.
 *
 *  2. Both halves of a Supabase config are required. A URL without a key is a
 *     misconfiguration, and inferring the key would turn a clear setup mistake
 *     into an opaque 401 from PostgREST.
 *
 * Returns null for "no backend", which the route turns into a 501.
 */
export function getStore(): RemoteStore | null {
  if (cached) return cached;

  // "neon" or "supabase". Absent means: only the MUSCIFY_-prefixed names count.
  const explicit = (process.env.MUSCIFY_SYNC_BACKEND ?? "").trim().toLowerCase();
  const wantsSupabase = explicit === "supabase" || explicit === "";
  const wantsNeon = explicit === "neon" || explicit === "";

  if (wantsSupabase) {
    // Prefixed names are unambiguous and need no opt-in. The generic ones are
    // only read when the backend was explicitly named — see rule 1.
    const generic = explicit === "supabase";
    const url =
      process.env.MUSCIFY_SUPABASE_URL ?? (generic ? (process.env.SUPABASE_URL ?? "") : "");
    const key =
      process.env.MUSCIFY_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.MUSCIFY_SUPABASE_KEY ??
      (generic ? (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "") : "");

    if (url && key) {
      cached = new SupabaseStore(supabaseUrl(url), key);
      return cached;
    }
    if (generic) {
      console.warn(
        "[muscify] MUSCIFY_SYNC_BACKEND=supabase but MUSCIFY_SUPABASE_URL and " +
          "MUSCIFY_SUPABASE_SERVICE_ROLE_KEY are not both set; library sync is off",
      );
      return null;
    }
  }

  if (wantsNeon) {
    const url = process.env.MUSCIFY_DATABASE_URL ?? "";
    if (url) {
      cached = new NeonStore(url);
      return cached;
    }

    // Only reachable when explicitly opted in; see rule 1 above.
    if (explicit === "neon") {
      const generic = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";
      if (generic) {
        cached = new NeonStore(generic);
        return cached;
      }
      console.warn(
        "[muscify] MUSCIFY_SYNC_BACKEND=neon but no database URL was found; library sync is off",
      );
      return null;
    }
  }

  return null;
}

/** Test seam — the store is memoised for the lifetime of the process. */
export function __resetStore(): void {
  cached = null;
}