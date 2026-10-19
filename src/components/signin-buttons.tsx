"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

import type { ProviderId } from "@/auth";

/**
 * The sign-in buttons.
 *
 * These were `<a href="/api/auth/signin/google">`, which is a **GET**, and
 * Auth.js v5 rejects it: the signin action is a POST carrying a CSRF token, so
 * a bare link lands on `?error=Configuration` and shows "There is a problem with
 * the server configuration" — an error that says nothing useful and is blamed
 * on the server rather than on the link.
 *
 * `signIn()` does the CSRF fetch and the POST, which is the only supported flow.
 * Verified after the change: a POST to the same endpoint returns a 302 to
 * `accounts.google.com` with the client id and the right `redirect_uri`.
 *
 * The button also reports what actually happened rather than failing silently,
 * because "nothing happened" is the default Auth.js behaviour and it is
 * indistinguishable from a broken deployment.
 */
export function SignInButtons({
  providers,
  labels,
}: {
  providers: ProviderId[];
  labels: Record<ProviderId, string>;
}) {
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      {providers.map((id) => (
        <button
          key={id}
          type="button"
          disabled={busy !== null}
          onClick={async () => {
            setError(null);
            setBusy(id);
            try {
              await signIn(id, { redirectTo: "/" });
              // Only reached if the redirect is somehow suppressed; a real
              // success navigates away before this runs.
              setBusy(null);
            } catch {
              setBusy(null);
              setError("Could not start sign-in. Check that this domain is listed as a redirect URI in your Google or GitHub OAuth app.");
            }
          }}
          className="flex items-center justify-center gap-2 rounded-full border border-line px-6 py-3 text-label font-semibold text-on transition hover:border-line-strong hover:bg-elevated disabled:opacity-50"
        >
          {busy === id ? "Redirecting…" : labels[id]}
        </button>
      ))}

      {error ? (
        <p role="alert" className="text-center text-micro text-amber-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}