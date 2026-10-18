-- muscify schema
--
-- Apply once, by hand:
--
--   psql "$MUSCIFY_DATABASE_URL" -f db/schema.sql
--
-- Deliberately *not* run at runtime. A serverless function that executes DDL on a
-- cold start is a race between concurrent instances, and a failed migration
-- should be a visible error rather than something swallowed and retried. The
-- app treats the schema as a precondition and reports clearly when it is absent.
--
-- This is plain Postgres on purpose. No provider-specific extensions, no
-- row-level-security dependency, no vendor role names: any Postgres 14+ works,
-- including one you already have. Copy the URL into MUSCIFY_DATABASE_URL and
-- nothing else is required.
--
-- ---------------------------------------------------------------------------
-- On the two library tables
-- ---------------------------------------------------------------------------
-- There are two, and they are not duplicates.
--
--   muscify_library   anonymous sync, keyed by a random device id
--   muscify_user_library     signed-in sync, keyed by our own user id
--
-- The split is a security boundary, not tidiness. A single table keyed by one
-- nullable "owner" column invites a class of bug where a request authenticated
-- as a user falls back to a client-supplied device id, and a caller ends up
-- reading someone else's library. With separate tables a device row is not
-- reachable from the user code path and a user row is not reachable from the
-- anonymous one, so the mistake becomes a type error instead of a data leak.
--
-- The names are asymmetric on purpose. muscify_library predates accounts and is
-- already deployed; renaming it to muscify_device_library would have read
-- better and orphaned everyone's data. Symmetry is not worth a migration.
--
-- This file creates both tables, so applying it alone is a complete setup.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Anonymous sync
-- ---------------------------------------------------------------------------
-- Created here as well as in SCHEMA_SQL (src/lib/persistence/server-store.ts),
-- and idempotently, so that applying *this* file alone gives a complete working
-- setup. Leaving the anonymous half out would have meant a deployment that has
-- accounts but no device sync -- a confusing half-configured state that fails
-- only for people who have not signed in.
create table if not exists muscify_library (
  device_id  text primary key,
  version    integer not null,
  snapshot   jsonb   not null,
  updated_at timestamptz not null default now()
);

create index if not exists muscify_library_updated_idx
  on muscify_library (updated_at desc);

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
-- Auth.js owns authentication. It hands us a verified profile, and this schema
-- owns what that profile *means* for the app: a stable user id that survives a
-- provider change, and the row the library hangs off.
--
-- `id` is minted here rather than taken from the provider, so the id stays ours.
-- A provider's user id is scoped to that provider and could collide across
-- providers; ours is prefixed with the provider at first sight and is never
-- reused for anyone else.
create table if not exists muscify_users (
  id            text primary key,
  email         text,
  name          text,
  image         text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- One row per linked OAuth identity. A person who signs in with both Google and
-- GitHub ends up with two rows and the same muscify_users.id.
--
-- The primary key is (provider, provider_account_id) and not the user id
-- because that is what the provider actually guarantees to be unique. Building
-- the key on our own id would make a provider-side id reuse merge two strangers,
-- which is exactly the failure this table exists to prevent.
create table if not exists muscify_accounts (
  provider            text not null,
  provider_account_id text not null,
  user_id             text not null references muscify_users (id) on delete cascade,
  created_at          timestamptz not null default now(),
  primary key (provider, provider_account_id)
);

create index if not exists muscify_accounts_user_idx on muscify_accounts (user_id);

-- Lookup path on every authenticated request, so it is indexed explicitly.
create index if not exists muscify_users_email_idx on muscify_users (email);

-- ---------------------------------------------------------------------------
-- Synchronised library, signed in
-- ---------------------------------------------------------------------------
-- One document per user, holding the same LibrarySnapshot shape the client
-- already stores locally. Deliberately a single jsonb document rather than
-- normalised tables: the snapshot is written whole on every change, conflicts
-- are resolved by last-write-wins on the client's own clock, and splitting it
-- across rows would buy referential integrity the client cannot enforce anyway.
--
-- The trade is stated rather than hidden: you cannot query "which users have
-- this playlist" in SQL. Nothing needs to, and the client is the only writer.
--
-- `updated_at` is the database clock, for operator use. Conflict resolution does
-- NOT use it -- see the note in the /api/library route about keeping the
-- client's stamp end-to-end.
create table if not exists muscify_user_library (
  user_id     text primary key references muscify_users (id) on delete cascade,
  version     integer not null,
  snapshot    jsonb    not null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Listening history
-- ---------------------------------------------------------------------------
-- The one unbounded table in the schema, and the only one that needs a policy
-- rather than a size cap. Raw play events are kept for 90 days to drive
-- "most played this week", then rolled into a daily aggregate and dropped.
--
-- Without this a heavy listener would grow the table without limit for data
-- nobody reads after a quarter.
create table if not exists muscify_play_events (
  id          bigserial primary key,
  user_id     text not null references muscify_users (id) on delete cascade,
  track_key   text not null,
  played_at   timestamptz not null default now(),
  listened_ms integer not null default 0,
  -- Private Session plays are recorded as NULL-tracked: excluded from every
  -- aggregate and deleted immediately. Storing them at all would defeat the
  -- feature, so they are filtered here rather than trusted to the caller.
  is_private  boolean not null default false
);

create index if not exists muscify_play_events_user_time_idx
  on muscify_play_events (user_id, played_at desc);

create index if not exists muscify_play_events_retention_idx
  on muscify_play_events (played_at);

-- The rollup. Small, cheap to read, and never expires.
create table if not exists muscify_play_daily (
  user_id     text not null references muscify_users (id) on delete cascade,
  day         date not null,
  track_key   text not null,
  plays       integer not null default 0,
  listened_ms bigint  not null default 0,
  primary key (user_id, day, track_key)
);

create index if not exists muscify_play_daily_day_idx on muscify_play_daily (user_id, day desc);

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
-- Rolls events older than the window into the daily table and deletes them.
--
-- Written as a function so it can be called by pg_cron, by a manual
-- `select prune_play_events();`, or by nothing at all. Nothing calls it
-- automatically, because a delete on someone else's schedule should be a
-- deliberate act rather than a surprise -- and because it is idempotent, so
-- running it twice is harmless.
--
-- The boundary is strict: an event exactly `retain_days` old is pruned, not
-- kept, and a second or so of wall-clock drift between the row being written
-- and the prune running means the practical window is marginally under the
-- stated one. Measured against Postgres 16: with retain_days = 90, an event at
-- 89 days survived, 90 and 91 days were both rolled up and deleted. That is
-- intended -- "keep 90 days" reads as a floor on precision, not an exact
-- cut-off -- but it is asserted here so a future change to `<` becoming `<=`
-- is a deliberate edit rather than a silent shift.
--
-- Days are bucketed in UTC via `at time zone 'utc'` rather than by the server's
-- local zone, so a rollup produces the same rows whether Postgres runs on GMT or
-- on a machine set to Asia/Kolkata.
create or replace function prune_play_events(retain_days integer default 90)
returns integer
language plpgsql
as $$
declare
  moved integer;
begin
  -- Fold the window into the rollup first. `on conflict do update` accumulates,
  -- so a track played on several expiries lands in the right daily row once.
  insert into muscify_play_daily (user_id, day, track_key, plays, listened_ms)
  select user_id, (played_at at time zone 'utc')::date, track_key,
         count(*)::integer, sum(listened_ms)::bigint
    from muscify_play_events
   where not is_private
     and played_at < now() - make_interval(days => retain_days)
   group by 1, 2, 3
  on conflict (user_id, day, track_key) do update
    set plays       = muscify_play_daily.plays       + excluded.plays,
        listened_ms = muscify_play_daily.listened_ms + excluded.listened_ms;

  delete from muscify_play_events where played_at < now() - make_interval(days => retain_days);

  get diagnostics moved = row_count;
  return moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- The app connects as a single role and needs nothing beyond CRUD on its own
-- tables. No CREATE on the public schema, so a compromised connection cannot
-- add objects, and no access to any other table in the database -- which matters
-- when this URL points at a shared instance.
--
-- Run this as the role's owner once, then revoke it from the connecting role:
--
--   revoke create on schema public from muscify;
--   grant usage on schema public to muscify;
--   grant select, insert, update, delete on all tables in schema public to muscify;