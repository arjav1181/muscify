/**
 * The owner allowlist, in one place.
 *
 * This was duplicated logic before: the middleware parsed
 * `MUSCIFY_ALLOWED_EMAILS` itself, and Auth.js did not check it at all -- which
 * meant anyone with a Google account could complete sign-in and walk away
 * holding a valid session, only to be turned away later at the app door. Three
 * call sites now share this so they cannot drift apart again.
 *
 * Semantics, deliberately narrow:
 *
 *  - **Empty list means no restriction.** A self-hosted copy of this repo has no
 *    allowlist and must let anyone sign in; otherwise every self-hoster has to
 *    discover a variable before they can use accounts at all.
 *  - **A non-empty list is exclusive.** Only those addresses may create an
 *    account or start a session.
 *
 * The distinction matters: "unset" and "set to nothing" mean opposite things,
 * and conflating them is how a private instance ends up open.
 */

const raw = (process.env.MUSCIFY_ALLOWED_EMAILS ?? "").trim();

/** True when an allowlist was configured at all. */
export const allowlistConfigured = raw.length > 0;

const ALLOWED = new Set(
  raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Whether this address may sign in.
 *
 * Case-insensitive and tolerant of surrounding whitespace, because people type
 * addresses with capitals and spaces and an allowlist that rejects
 * `Alice@Example.com` fails in a way that looks like a broken app rather than a
 * typo.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!allowlistConfigured) return true;
  if (!email) return false;
  return ALLOWED.has(email.trim().toLowerCase());
}

/**
 * A message safe to show a rejected person.
 *
 * Says the address is not on the list without confirming whether it *could*
 * ever be added. A message that named the configured addresses would hand a
 * stranger the owner's email address.
 */
export const NOT_ALLOWED_MESSAGE =
  "That address is not on this instance's list.";

/** For logs and tests. Never returned to a caller. */
export function allowedForTesting(): string[] {
  return [...ALLOWED];
}