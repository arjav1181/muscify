-- Password credentials.
--
-- Separate from muscify_users on purpose. Auth.js owns the OAuth path, where
-- the provider is the source of truth and there is no password to lose; this
-- table holds one row per address that has ever set a password, and a user with
-- no row simply has no password credential. Nothing here is required by OAuth,
-- and deleting the whole table returns the instance to Google-only sign-in.
--
-- The hash is stored exactly as produced by scrypt -- "scrypt$N$r$p$salt$hash"
-- -- so the cost parameters travel with the row. Raising them later does not
-- invalidate anybody's password, which is the whole reason they are not three
-- bare columns.
create table if not exists muscify_passwords (
  user_id     text primary key references muscify_users (id) on delete cascade,
  -- Unique as well as primary, so one address cannot end up with two
  -- credentials that sign into the same account through different paths.
  email       text not null unique,
  hash        text not null,
  created_at  timestamptz not null default now(),
  -- Bumped on every successful reset, so an old hash is detectably stale.
  rotated_at  timestamptz not null default now()
);

create index if not exists muscify_passwords_email_idx on muscify_passwords (lower(email));

-- Failed sign-in attempts, for rate limiting.
--
-- Unbounded in principle, so it is pruned by the same function that prunes
-- play events: rows older than a day are dropped and have no effect on any
-- window anyone cares about.
create table if not exists muscify_signin_attempts (
  id          bigserial primary key,
  -- The email as typed, lowercased. Nullable because a request may carry no
  -- usable address at all, and those still count against the address limit.
  email       text,
  ip          text,
  succeeded   boolean not null default false,
  at          timestamptz not null default now()
);

create index if not exists muscify_signin_attempts_lookup_idx
  on muscify_signin_attempts (email, at desc);

create index if not exists muscify_signin_attempts_ip_idx
  on muscify_signin_attempts (ip, at desc);