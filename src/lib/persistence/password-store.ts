import { PostgresStore } from "./postgres-store.ts";
import { decoyHash, hashPassword, verifyPassword } from "../auth/password.ts";

/**
 * Password credentials against Postgres.
 *
 * Three things this does that a naive implementation does not:
 *
 *  - **Unknown accounts cost the same as wrong passwords.** `signIn` verifies a
 *    decoy hash when there is no account, so response time does not reveal which
 *    addresses exist.
 *  - **Failures are counted.** `signIn` records every attempt, and the route
 *    refuses before hashing when the limit is passed. Without that, limiting
 *    rate only wastes 100 ms of scrypt per guess, which is exactly the cost an
 *    attacker wants you to pay.
 *  - **The address is compared by lookup, not by a query the caller can shape.**
 *    Every value is a bound parameter.
 */

const MAX_ATTEMPTS = 8;
/** Window those attempts are counted over. */
const WINDOW_MINUTES = 15;

export interface PasswordUser {
  userId: string;
  email: string;
}

export class PasswordStore {
  private db: PostgresStore;

  // An explicit field rather than a TypeScript parameter property
  // (`constructor(private db)`): Node's type stripping runs in strip-only mode
  // and rejects parameter properties outright, so the test runner would fail on
  // this file before a single assertion ran.
  constructor(db: PostgresStore) {
    this.db = db;
  }

  /** Creates the account and its password credential in one place. */
  async create(email: string, password: string): Promise<PasswordUser> {
    const clean = email.trim().toLowerCase();
    const hash = await hashPassword(password);

    // Our own user id, minted the same way as the OAuth path so a person who
    // sets a password and later signs in with Google is still two distinct
    // accounts rather than a collision.
    const userId = `password_${hash.slice(hash.lastIndexOf("$") + 1, hash.lastIndexOf("$") + 23)}`;

    await this.db.ensurePasswordUser(userId, clean, hash);
    return { userId, email: clean };
  }

  /** Replaces an existing password. Used by the CLI reset, and by nobody else. */
  async setPassword(email: string, password: string): Promise<boolean> {
    const clean = email.trim().toLowerCase();
    const hash = await hashPassword(password);
    return this.db.setPasswordForEmail(clean, hash);
  }

  /**
   * Verifies a credential.
   *
   * Always does the work, whether or not the account exists, and returns the
   * same shape either way. The caller must not branch on `null` in a way that is
   * visible to the requester.
   */
  async signIn(
    email: string,
    password: string,
    ip: string | null,
  ): Promise<{ userId: string; email: string } | null> {
    const clean = email.trim().toLowerCase();

    if (await this.attemptCount(clean, ip) >= MAX_ATTEMPTS) {
      // Refused before doing any hashing, so the limiter is not a way to make
      // the server burn CPU.
      throw new TooManyAttemptsError();
    }

    const row = await this.db.findPasswordUser(clean);

    const ok = row
      ? await verifyPassword(password, row.hash)
      : // Unknown address: spend the same time, then fail.
        (await verifyPassword(password, await decoyHash()), false);

    await this.recordAttempt(clean, ip, ok);

    if (!ok || !row) return null;
    return { userId: row.userId, email: row.email };
  }

  private async attemptCount(email: string, ip: string | null): Promise<number> {
    return this.db.countRecentAttempts(email, ip, WINDOW_MINUTES);
  }

  private async recordAttempt(email: string, ip: string | null, ok: boolean): Promise<void> {
    await this.db.recordSigninAttempt(email, ip, ok);
  }
}

export class TooManyAttemptsError extends Error {
  constructor() {
    super("Too many sign-in attempts. Try again later.");
    this.name = "TooManyAttemptsError";
  }
}

export { MAX_ATTEMPTS, WINDOW_MINUTES };