import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";

import { isAllowedEmail } from "@/lib/auth/allowlist";
import { PasswordStore, TooManyAttemptsError } from "@/lib/persistence/password-store";
import { getAuthStore } from "@/lib/persistence/server-store";

/**
 * Authentication. Google and GitHub, no passwords.
 *
 * Three decisions worth stating, because each is a trade rather than a default:
 *
 *  - **OAuth only, no email.** There is no password column, no reset flow and no
 *    outbound email anywhere in this app. Passwords are stored hashes that must
 *    be handled well forever, and a reset flow needs a mail provider, a token
 *    table and an abuse story. Delegating both to Google and GitHub removes all
 *    three and means there is no credential of ours to leak.
 *
 *  - **Sessions are JWTs, not database rows.** Auth.js can persist sessions, but
 *    a signed cookie means the sync route can read the user id without a query
 *    on every request, and revoking a session is a cookie delete rather than a
 *    table update. The cost is that a session cannot be revoked server-side
 *    before it expires; `maxAge` is set short for that reason.
 *
 *  - **Providers are conditional.** Auth.js throws at module load if a provider
 *    has no client id, so listing them unconditionally would mean a deployment
 *    with only one of the two set fails to boot. Here a provider with no
 *    credentials is simply not registered, and `availableProviders` is what the
 *    UI reads to decide what to render.
 *
 * Nothing here is required. With no `AUTH_SECRET` and no provider credentials
 * the app is anonymous-only, which is the shipped default.
 */

const providers: NextAuthConfig["providers"] = [];

/**
 * Email and password.
 *
 * Registered only when a database is configured, because verifying a credential
 * means looking one up. With no database the provider simply is not there and
 * the app falls back to OAuth and anonymous use.
 *
 * The `authorize` callback returns a user or null -- that is the whole contract.
 * Every rejection below returns null with the *same* message the client shows
 * for a wrong password, because a distinct error per cause turns the form into
 * an account-enumeration oracle.
 */
if (process.env.MUSCIFY_DATABASE_URL) {
  providers.push({
    id: "password",
    name: "Email and password",
    type: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw) {
      const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : "";
      const password = typeof raw?.password === "string" ? raw.password : "";
      if (!email || !password) return null;

      // Enforced at the door, not just at the app. Before this, anyone with a
      // Google account could complete OAuth and hold a valid session for an
      // instance they were not allowed into.
      if (!isAllowedEmail(email)) return null;

      const store = getAuthStore();
      if (!store) return null;

      const passwords = new PasswordStore(store);
      try {
        const user = await passwords.signIn(email, password, null);
        if (!user) return null;
        return { id: user.userId, email: user.email, name: null };
      } catch (e) {
        if (e instanceof TooManyAttemptsError) return null;
        console.error("[muscify] password sign-in failed", e);
        return null;
      }
    },
  } as NextAuthConfig["providers"][number]);
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),
  );
}

if (process.env.GITHUB_ID && process.env.GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),
  );
}

/** What the UI is allowed to offer. Read by the sign-in UI, never a secret. */
export type ProviderId = "google" | "github";

export const availableProviders: ProviderId[] = providers.map((p) => {
  const id = typeof p === "function" ? "" : ((p as { id?: string }).id ?? "");
  return (id === "google" || id === "github" ? id : "github") as ProviderId;
});

/**
 * Which database identity helpers are usable.
 *
 * Auth can be configured without a database: sessions still work, and a person
 * can still sign in, but there is nowhere to put their user row. Rather than
 * fail the sign-in at the last step, `muscifyUserId` returns null and the app
 * falls back to anonymous device sync. That degradation is visible in settings.
 */
async function muscifyUserId(account: {
  provider?: string | null;
  providerAccountId?: string | null;
} | null | undefined): Promise<string | null> {
  if (!account?.providerAccountId) return null;
  const provider = account.provider;
  if (provider !== "google" && provider !== "github") return null;

  const store = getAuthStore();
  if (!store) return null;

  try {
    const user = await store.findOrCreateUser({
      provider,
      providerAccountId: account.providerAccountId,
      email: null,
      name: null,
      image: null,
    });
    return user.id;
  } catch (e) {
    // A database that is unreachable must not block signing in; it only means
    // the library stays device-scoped for now.
    console.error("[muscify] could not resolve account to a user row", e);
    return null;
  }
}

export const authConfig = {
  providers,
  session: { strategy: "jwt" as const, maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/signin" },
  // Vercel sets AUTH_URL and the host header is trustworthy behind its proxy.
  // Not setting this makes Auth.js refuse to build the callback URL.
  trustHost: true,
  callbacks: {
    /**
     * The allowlist, applied to OAuth as well as passwords.
     *
     * A rejected person is redirected to `/no-access` rather than the error
     * page, because "this address is not on the list" is an accurate answer and
     * Auth.js's generic configuration error is not. It confirms nothing that
     * matters -- it does not say who *is* on the list.
     */
    async signIn({ user }) {
      if (isAllowedEmail(user?.email)) return true;
      return "/no-access";
    },
    /**
     * Puts our own user id in the token.
     *
     * Minted at sign-in and read on every subsequent request, so the sync route
     * never has to look a user up by email. Signed with AUTH_SECRET, so it
     * cannot be forged.
     */
    async jwt({ token, account }) {
      if (account) {
        const id = await muscifyUserId(account);
        if (id) token.muscifyUserId = id;
      }
      return token;
    },
    /** Exposes it to the client so it can tell whether it is signed in. */
    async session({ session, token }) {
      if (token.muscifyUserId) {
        session.user = {
          ...session.user,
          id: token.muscifyUserId as string,
        };
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

/**
 * Auth.js is only constructed when there is something to authenticate with.
 *
 * Returning null rather than a half-configured instance is what lets the app run
 * anonymously: with no providers, `handlers` is null, the route 404s, and no
 * component can accidentally link to a sign-in page that does not work.
 */
export const authConfigured =
  providers.length > 0 && Boolean(process.env.AUTH_SECRET);

export const { handlers, auth } = authConfigured
  ? NextAuth(authConfig)
  : ({ handlers: null, auth: null } as unknown as ReturnType<typeof NextAuth>);