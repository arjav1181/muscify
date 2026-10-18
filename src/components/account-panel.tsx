"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut, Loader2, ShieldCheck } from "lucide-react";

/**
 * Account state in the app.
 *
 * A deliberately small client rather than a session provider threaded through
 * the tree. Sign-in changes almost nothing about how the app behaves — the
 * library is local-first either way — so the only thing that needs to react is
 * this panel. Anything that propagated further would be coupling for its own
 * sake.
 *
 * The session is read from Auth.js's own endpoint rather than being passed down
 * from a server component, because `auth()` is null on any deployment without
 * `AUTH_SECRET`. Constructing the session would mean importing it on a page
 * that has to render without it, which is the dependency this app is trying not
 * to acquire.
 */

interface SessionUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface Session {
  user?: SessionUser;
  expires?: string;
}

type State =
  | { kind: "loading" }
  /** No accounts configured on this deployment. The default. */
  | { kind: "unavailable" }
  | { kind: "anonymous" }
  | { kind: "signed-in"; user: SessionUser };

export function AccountPanel() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        // 404 is the route's answer when no providers are configured. That is
        // the shipped default, so it is a normal state rather than an error.
        if (res.status === 404) {
          if (live) setState({ kind: "unavailable" });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Session | null;
        if (!live) return;
        setState(body?.user ? { kind: "signed-in", user: body.user } : { kind: "anonymous" });
      } catch {
        if (live) setState({ kind: "unavailable" });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 text-body text-muted">
        <Loader2 size={15} className="animate-spin" aria-hidden />
        <span>Checking account…</span>
      </div>
    );
  }

  // Nothing to sign in to. Say so plainly rather than showing a dead button.
  if (state.kind === "unavailable") {
    return (
      <p className="text-body text-dim">
        Accounts are not configured on this deployment, so your library stays on this device. Nothing
        is sent anywhere.
      </p>
    );
  }

  if (state.kind === "signed-in") {
    return (
      <div className="flex items-center gap-3">
        {state.user.image ? (
          // Remote avatar from the OAuth provider. next/image would add an
          // allowlist and a proxy hop to render a 32px circle.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={state.user.image}
            alt=""
            width={32}
            height={32}
            className="size-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-highlight text-micro font-bold text-sub"
          >
            {(state.user.name ?? "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-label font-semibold text-on">
            {state.user.name ?? state.user.email ?? "Signed in"}
          </p>
          <p className="truncate text-micro text-sub">
            Your library follows you between devices.
          </p>
        </div>
        {/*
          A full navigation, not a client-side one. Auth.js has to clear the
          session cookie server-side, and the app then has to re-render from
          the server rather than patch one panel — so `next/link` would be
          actively wrong here, and would leave a signed-out UI pointing at a
          live session. The lint rule below is about page navigation; this is
          an endpoint that redirects.
        */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/auth/signout"
          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-micro font-semibold text-sub transition hover:border-line-strong hover:text-on"
        >
          <LogOut size={13} aria-hidden />
          Sign out
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="min-w-0 flex-1 text-body text-sub">
        Sign in and your library follows you between devices.
      </p>
      <a
        href="/signin"
        className="flex items-center gap-1.5 rounded-full bg-on px-4 py-2 text-micro font-bold text-black transition hover:scale-[1.02]"
      >
        <LogIn size={13} aria-hidden />
        Sign in
      </a>
    </div>
  );
}

/** The one-line explanation shown under the row. */
export function AccountNote({ state }: { state: "signed-in" | "anonymous" | "unavailable" }) {
  if (state === "signed-in") {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-micro text-sub">
        <ShieldCheck size={13} className="mt-px shrink-0 text-green-400" aria-hidden />
        <span>
          No password is stored and no email is sent. Signing out stops syncing but does not delete
          anything already on your other devices.
        </span>
      </p>
    );
  }
  return null;
}