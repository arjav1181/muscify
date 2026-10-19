import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing.
 *
 * **scrypt from Node's own `crypto`**, deliberately, rather than argon2bcrypt.
 * scrypt is memory-hard, which is the property that actually matters against GPU
 * cracking, and it ships in the standard library -- so there is no native module
 * to compile, nothing for a package registry to serve, and no supply-chain
 * surface added to a project whose whole premise is not being locked into
 * someone else's stack.
 *
 * The stored format is self-describing, so parameters can be raised later
 * without invalidating anyone's password:
 *
 *     scrypt$N$r$p$<salt-b64>$<hash-b64>
 *
 * ## What this does not do
 *
 * There is no self-service reset, because there is no email provider and a
 * reset that mails a code is the only kind worth shipping. `scripts/set-password.ts`
 * sets one from the CLI instead. That is a real limitation, not an oversight:
 * a forgotten password means asking for a reset, not clicking a link.
 */

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Cost parameters.
 *
 * N=2^14, r=8, p=1 costs about 16 MB per hash and roughly 60-100 ms here.
 * `maxmem` is raised explicitly because Node's default of 32 MB is exactly the
 * memory this configuration needs, and asking for precisely the default is how
 * you get an allocation failure on someone else's machine.
 *
 * Raise N when hardware improves. Old hashes keep verifying because the
 * parameters travel with them.
 */
const N = 16384;
const R = 8;
const P = 1;
const MAXMEM = 64 * 1024 * 1024;
const KEYLEN = 32;
const SALT_BYTES = 16;

/** Lower bound. Length is the one thing that is cheap to enforce and expensive to skip. */
export const MIN_PASSWORD_LENGTH = 10;

export class WeakPasswordError extends Error {}

/**
 * Hashes a password.
 *
 * Throws rather than returning a weak hash, so there is no way to accidentally
 * store something hashable. The check is length only, and that is deliberate --
 * composition rules push people toward `Passw0rd!`, which is worse than a long
 * passphrase, and any real strength requirement needs a breached-password list
 * this codebase has no way to maintain.
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash, because a corrupt row
 * must not become a 500 that tells an attacker they found something.
 *
 * The comparison is constant-time. A byte-by-byte early return leaks the
 * matching prefix length and turns a hash comparison into an oracle.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;

    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (expected.length === 0) return false;

    const actual = await scryptAsync(password, salt, expected.length, {
      // Parameters come from the stored row, bounded, so a corrupt or hostile
      // value cannot ask for a hash that exhausts memory.
      N: clampPow2(n),
      r: clampParam(r, 32),
      p: clampParam(p, 16),
      maxmem: MAXMEM,
    });

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** N must be a power of two; scrypt refuses anything else. */
function clampPow2(n: number): number {
  if (!Number.isInteger(n) || n < 2) return 2;
  // 2^20 is 1 GB with r=8. Nothing legitimate needs more.
  return Math.min(1 << 20, n);
}

function clampParam(v: number, max: number): number {
  if (!Number.isInteger(v) || v < 1) return 1;
  return Math.min(max, v);
}

/**
 * A hash for an unknown user, so sign-in takes the same time either way.
 *
 * Without this, "no such account" returns in a millisecond and "wrong password"
 * takes 100 ms, which is a free account-enumeration oracle: an attacker can tell
 * which addresses have accounts by timing alone, with no error message to read.
 * The caller verifies against this when the user is not found.
 */
let decoy: string | null = null;
export async function decoyHash(): Promise<string> {
  decoy ??= await hashPassword(`decoy-${randomBytes(16).toString("hex")}`);
  return decoy;
}