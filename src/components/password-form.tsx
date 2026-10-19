"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

/**
 * Email and password, and account creation.
 *
 * Both share one form because both submit to `/api/auth/register` and then
 * immediately sign in -- the alternative, a separate page and a separate button,
 * doubles the ways this can be got wrong for very little gain.
 *
 * Two behaviours that matter and are easy to omit:
 *
 *  - The error from a refused sign-in is shown **verbatim**. The server already
 *    refuses to distinguish "no such account" from "wrong password" so the form
 *    must not invent a distinction either.
 *  - `autoComplete` is set properly. `current-password` and `new-password` are
 *    what let a password manager fill this in; without them every account here
 *    is typed by hand and remembered by the person.
 */
export function PasswordForm({ canRegister }: { canRegister: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const body = (await res.json()) as { ok?: boolean; reason?: string };
        if (!body.ok) {
          setError(body.reason ?? "Could not create that account.");
          setBusy(false);
          return;
        }
      }

      const result = await signIn("password", { email, password, redirect: false });
      if (result?.error) {
        // One message for every failure. Anything more specific would let
        // someone work out which addresses have accounts.
        setError("That email and password do not match an account.");
        setBusy(false);
        return;
      }
      // A client-side push rather than a hard navigation: the session cookie
      // is already set, and a full reload would re-fetch every route before
      // showing anything.
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not sign in. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-micro font-semibold text-sub">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-line bg-elevated px-3 py-2.5 text-label text-on outline-none focus:border-line-strong"
          placeholder="you@example.com"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-micro font-semibold text-sub">Password</span>
        <input
          type="password"
          required
          minLength={10}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-line bg-elevated px-3 py-2.5 text-label text-on outline-none focus:border-line-strong"
          placeholder={mode === "signup" ? "At least 10 characters" : "••••••••••"}
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-on px-6 py-3 text-label font-semibold text-black transition hover:scale-[1.02] disabled:opacity-50"
      >
        {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>

      {error ? (
        <p role="alert" className="text-center text-micro text-amber-400">
          {error}
        </p>
      ) : null}

      {canRegister ? (
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="text-center text-micro font-semibold text-sub underline underline-offset-4 transition hover:text-on"
        >
          {mode === "signin" ? "Need an account? Create one" : "Already have one? Sign in"}
        </button>
      ) : null}

      <p className="text-center text-micro text-dim">
        There is no password reset. Ask whoever runs this instance to set you a new one.
      </p>
    </form>
  );
}