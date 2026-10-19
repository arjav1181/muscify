import { redirect } from "next/navigation";
import { LogIn } from "lucide-react";

import { SignInButtons } from "@/components/signin-buttons";
import { availableProviders, auth, authConfigured } from "@/auth";

/**
 * Sign in.
 *
 * Reached only when accounts are actually configured: `page.tsx` for this route
 * does nothing but render this component, and when no provider credentials or
 * `AUTH_SECRET` exist there is nothing to sign in with, so it redirects home
 * rather than showing a form that cannot work.
 *
 * Two things this page deliberately does not do:
 *
 *  - It does not mention what an account is for beyond the one line below.
 *    Accounts are optional and the app is complete without one, so the pitch is
 *    one sentence rather than a comparison table.
 *  - It does not collect an email address. There is no password to forget and
 *    nothing to verify here; the provider owns all of that, and asking for an
 *    address we have no use for would be collecting a credential for nothing.
 *
 * The buttons are a client component because Auth.js v5 sign-in is a POST with a
 * CSRF token, not a link. See `SignInButtons`.
 */

export const metadata = { title: "Sign in · muscify" };

const PROVIDER_LABELS: Record<(typeof availableProviders)[number], string> = {
  google: "Continue with Google",
  github: "Continue with GitHub",
};

export default async function SignInPage() {
  // Already signed in? There is nothing to do here.
  if (auth) {
    const session = await auth();
    if (session?.user) redirect("/");
  }

  if (!authConfigured || availableProviders.length === 0) redirect("/");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="flex size-14 items-center justify-center rounded-full bg-spotify text-black"
        >
          <LogIn size={24} />
        </span>
        <h1 className="text-title font-bold tracking-tight text-on">Sign in to muscify</h1>
        <p className="max-w-sm text-body text-sub">
          Optional. Your library syncs across devices with an account, and without one it stays on
          this device.
        </p>
      </div>

      <SignInButtons providers={availableProviders} labels={PROVIDER_LABELS} />

      <p className="max-w-xs text-center text-micro text-dim">
        muscify stores no password and sends no email. Your display name and avatar come from the
        provider you choose.
      </p>
    </main>
  );
}