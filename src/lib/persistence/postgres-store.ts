import type { LibrarySnapshot } from "./types.ts";

/**
 * Plain Postgres, over a connection string.
 *
 * Any Postgres 14+ works: the one you already have, or one on Neon, Supabase,
 * RDS or a Raspberry Pi in a cupboard. There is no provider-specific client
 * here and no dependency on a vendor's role names, because the point of
 * dropping Supabase was to not be locked into it. The schema it needs is
 * `db/schema.sql` and nothing else.
 *
 * The driver is loaded on first use rather than imported statically, for the
 * same reason the Neon store defers its import: a deployment with no database
 * configured must not pay for it, and a misconfigured URL must not produce an
 * unhandled rejection at module load. It is memoised after the first call
 * because the driver pools internally and rebuilding per request would open a
 * new pool on every save.
 *
 * Two library tables, chosen by owner kind:
 *
 *   device -> muscify_library       (anonymous sync, the long-standing path)
 *   user   -> muscify_user_library (signed-in sync)
 *
 * Keeping them separate is deliberate. With one table and a nullable owner
 * column, a bug where an authenticated request falls back to a client-supplied
 * device id becomes a way to read another person's library. Here the choice of
 * table *is* the authorisation decision, and it is made from the server's own
 * session rather than from anything in the request body.
 *
 * The names are asymmetric on purpose. `muscify_library` predates accounts and
 * is the name already deployed; renaming it to `muscify_device_library` would
 * have read better and orphaned everyone's data, which is a bad trade for
 * symmetry.
 */

/** The narrow slice of the `postgres` driver this module uses. */
interface Sql {
  unsafe(query: string, params?: unknown[]): Promise<unknown[]>;
}

/** One library row, whichever table it came from. */
export interface LibraryRow {
  version: number;
  snapshot: LibrarySnapshot;
  updated_at: string;
}

/** What Auth.js hands us about a verified OAuth profile. */
export interface ProviderProfile {
  provider: "google" | "github";
  /** The provider's own id for this person. Unique within that provider only. */
  providerAccountId: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
}

/** Our user row. */
export interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
}

const DEVICE_TABLE = "muscify_library";
const USER_TABLE = "muscify_user_library";

/**
 * Normalises a snapshot read back from the database.
 *
 * Writes pass the snapshot object and let the driver serialise it. Reads still
 * handle a string defensively, because rows written by the earlier
 * `JSON.stringify(...)::jsonb` form are stored as a JSON *string scalar* --
 * double-encoded -- and those exist on any database that has already been used
 * with that code. Parsing them here upgrades them in place on the next write
 * instead of handing the client a string where it expects an object.
 */
function coerceSnapshot(raw: unknown): LibrarySnapshot {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as LibrarySnapshot;
    } catch {
      // Not JSON at all. Handing back an empty document beats throwing, which
      // would turn one corrupt row into an unbootable app.
      return { version: 2 } as LibrarySnapshot;
    }
  }
  return raw as LibrarySnapshot;
}

export class PostgresStore {
  readonly name = "postgres" as const;
  private url: string;
  private sqlPromise: Promise<Sql> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Closes the pool.
   *
   * Without this a process that has run a query never exits: the driver holds
   * sockets open, so a test file or a one-off script sits there until something
   * kills it. Serverless invocations never reach it -- the runtime reclaims the
   * instance -- but tests and scripts need it.
   */
  async close(): Promise<void> {
    const pending = this.sqlPromise;
    this.sqlPromise = null;
    const client = pending ? await pending.catch(() => null) : null;
    const end = (client as unknown as { end?: () => Promise<void> } | null)?.end;
    if (end) await end.call(client);
  }

  private sql(): Promise<Sql> {
    this.sqlPromise ??= (import("postgres") as Promise<{ default: (u: string) => Sql }>)
      .then((mod) => mod.default(this.url));
    return this.sqlPromise;
  }

  /**
   * Runs a parameterised query.
   *
   * Values always travel as bound parameters, never interpolated into the SQL
   * text. `unsafe` is the driver's name for "here is a string", not "here is
   * untrusted input" -- the parameters are still bound by the driver.
   */
  private async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
    const sql = await this.sql();
    return (await sql.unsafe(text, params)) as T[];
  }

  // -------------------------------------------------------------------------
  // Anonymous sync -- the existing device-keyed path
  // -------------------------------------------------------------------------

  async readDevice(deviceId: string): Promise<LibraryRow | null> {
    const rows = await this.query<LibraryRow>(
      `select version, snapshot, updated_at from ${DEVICE_TABLE} where device_id = $1 limit 1`,
      [deviceId],
    );
    return rows[0] ? { ...rows[0], snapshot: coerceSnapshot(rows[0].snapshot) } : null;
  }

  async writeDevice(deviceId: string, snapshot: LibrarySnapshot): Promise<void> {
    await this.query(
      `insert into ${DEVICE_TABLE} (device_id, version, snapshot, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (device_id) do update
         set version    = excluded.version,
             snapshot   = excluded.snapshot,
             updated_at = now()`,
      [deviceId, snapshot.version, snapshot],
    );
  }

  async removeDevice(deviceId: string): Promise<void> {
    await this.query(`delete from ${DEVICE_TABLE} where device_id = $1`, [deviceId]);
  }

  // -------------------------------------------------------------------------
  // Signed-in sync -- keyed by our user id, never by a client-supplied value
  // -------------------------------------------------------------------------

  async readUser(userId: string): Promise<LibraryRow | null> {
    const rows = await this.query<LibraryRow>(
      `select version, snapshot, updated_at from ${USER_TABLE} where user_id = $1 limit 1`,
      [userId],
    );
    return rows[0] ? { ...rows[0], snapshot: coerceSnapshot(rows[0].snapshot) } : null;
  }

  async writeUser(userId: string, snapshot: LibrarySnapshot): Promise<void> {
    await this.query(
      `insert into ${USER_TABLE} (user_id, version, snapshot, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (user_id) do update
         set version    = excluded.version,
             snapshot   = excluded.snapshot,
             updated_at = now()`,
      [userId, snapshot.version, snapshot],
    );
  }

  async removeUser(userId: string): Promise<void> {
    await this.query(`delete from ${USER_TABLE} where user_id = $1`, [userId]);
  }

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /**
   * Finds the app user behind an OAuth identity, creating it on first sight.
   *
   * The mapping lives in `muscify_accounts` keyed by
   * (provider, provider_account_id), which is the only pair the provider
   * actually promises is unique. Our own `muscify_users.id` is minted from that
   * pair and never reused for anyone else.
   *
   * Two people signing in with Google and GitHub get one row between them only
   * if they prove the same email address to both providers -- this deliberately
   * does NOT merge on matching email. Auto-merging on email is how unrelated
   * accounts get welded together, and the cost of failing to merge (a person
   * signs in twice and sees two libraries) is far lower than the cost of
   * getting it wrong. Linking is a separate, deliberate action.
   */
  async findOrCreateUser(profile: ProviderProfile): Promise<UserRow> {
    const existing = await this.query<UserRow & { created_at: string }>(
      `select u.id, u.email, u.name, u.image
         from muscify_accounts a
         join muscify_users u on u.id = a.user_id
        where a.provider = $1 and a.provider_account_id = $2
        limit 1`,
      [profile.provider, profile.providerAccountId],
    );

    if (existing[0]) {
      await this.query(
        `update muscify_users set last_seen_at = now() where id = $1`,
        [existing[0].id],
      );
      return existing[0];
    }

    const id = `${profile.provider}_${profile.providerAccountId}`;

    // Two concurrent first sign-ins for the same person can both reach here, so
    // the insert is written to tolerate losing the race rather than throwing:
    // the conflict target is the provider pair, which is the thing that is
    // genuinely unique.
    const rows = await this.query<UserRow>(
      `insert into muscify_users (id, email, name, image)
       values ($1, $2, $3, $4)
       on conflict (id) do update set last_seen_at = now()
       returning id, email, name, image`,
      [id, profile.email ?? null, profile.name ?? null, profile.image ?? null],
    );

    await this.query(
      `insert into muscify_accounts (provider, provider_account_id, user_id)
       values ($1, $2, $3)
       on conflict (provider, provider_account_id) do nothing`,
      [profile.provider, profile.providerAccountId, id],
    );

    return rows[0];
  }

  /** True when the schema is present. Used to report a clear setup error. */
  async schemaReady(): Promise<boolean> {
    const rows = await this.query<{ present: boolean }>(
      `select exists (
         select 1 from information_schema.tables
          where table_schema = 'public' and table_name = $1
       ) as present`,
      [USER_TABLE],
    );
    return rows[0]?.present === true;
  }
}