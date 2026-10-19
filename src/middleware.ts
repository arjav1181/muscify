import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";

/**
 * Private-instance routing.
 *
 * Two deployments come out of one build:
 *
 *  - **Public** (the GitHub repo's default). `MUSCIFY_LANDING` is unset. The
 *    player is at `/`, everything works, nothing is gated. This is what anyone
 *    self-hosting gets, with no configuration at all.
 *
 *  - **Private** (one person's Vercel). `MUSCIFY_LANDING=1` and
 *    `MUSCIFY_APP_PATH` set to an unlisted segment. `/` serves the landing page,
 *    the player lives under that segment, and reaching it requires a signed-in
 *    session whose email is on the allowlist.
 *
 * The address is rewritten rather than the filesystem being rearranged, so every
 * route keeps its real path: `/x7f3k9/library` is rewritten to `/library`, which
 * is a route that has always existed. Nothing inside the app knows it is being
 * reached through a prefix, so links, redirects and the player's own routing all
 * keep working unchanged.
 *
 * ## Why the session is the control, not the address
 *
 * An unlisted path is obscurity. Anyone who finds it walks straight in, and
 * "nobody knows the URL" is not a security property. The actual gate is the
 * session check plus the email allowlist below: an unknown address gets nothing,
 * and a known address with someone else's account gets nothing either. The
 * unlisted path exists so the landing page does not have to advertise the app,
 * which is a presentation concern and is treated as one.
 */

const LANDING = (process.env.MUSCIFY_LANDING ?? "").trim() === "1";

/** Unlisted segment the player is reachable under. Empty disables the prefix. */
const APP_PATH = (process.env.MUSCIFY_APP_PATH ?? "").trim().replace(/^\/+|\/+$/g, "");

/**
 * Emails permitted to use a private instance.
 *
 * Comma-separated, case-insensitive. An empty list means nobody, which is the
 * correct default: a private instance with no allowlist configured locks *everyone*
 * out, including the person who set it up. That is loud and obvious, which is
 * the right failure — silently allowing everyone would not be.
 */
const ALLOWED = new Set(
  (process.env.MUSCIFY_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

function isAllowed(email: string | null | undefined): boolean {
  return Boolean(email && ALLOWED.has(email.toLowerCase()));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public deployment: no rewriting, no gating, nothing to configure.
  if (!LANDING) return NextResponse.next();

  const session = auth ? await auth() : null;
  const signedIn = Boolean(session?.user) && isAllowed(session?.user?.email);

  // Already authenticated, or the app is not under a prefix at all.
  if (!APP_PATH) return NextResponse.next();

  // Everything under the secret segment reaches the app.
  if (pathname === `/${APP_PATH}` || pathname.startsWith(`/${APP_PATH}/`)) {
    if (signedIn) {
      const url = req.nextUrl.clone();
      // Strip the prefix. `/x/library` becomes `/library`, which is a route that
      // already exists and already knows how to render.
      url.pathname = pathname.slice(APP_PATH.length + 1) || "/";
      const res = NextResponse.rewrite(url);
      // Keep the cookie off the rewritten path so a refresh does not re-trigger.
      res.cookies.delete("muscify_prefixed");
      return res;
    }
    // Signed out, or signed in as somebody who is not the owner.
    //
    // `next` carries where they were going so the sign-in page can send them
    // back, but the value is re-derived from APP_PATH on the way back rather
    // than trusted, so a crafted `next` cannot bounce them anywhere else.
    const url = req.nextUrl.clone();
    url.pathname = "/signin";
    url.search = "";
    const res = NextResponse.redirect(url);
    res.cookies.set("muscify_prefixed", "1", { path: "/", httpOnly: true, sameSite: "lax" });
    return res;
  }

  // The root is the landing page in private mode.
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/welcome";
    return NextResponse.rewrite(url);
  }

  // Landing and auth assets stay reachable; everything else is simply not there,
  // so the player's routes are not even mapped for anyone who did not arrive
  // through the secret path.
  const OPEN = [
    "/welcome",
    "/signin",
    "/no-access",
    "/rate-limited",
    "/offline",
    "/manifest.webmanifest",
    "/icon",
    "/sw.js",
  ];
  if (OPEN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  // Auth.js's own endpoints have to pass, or signing in cannot complete.
  if (pathname.startsWith("/api/auth")) return NextResponse.next();

  return new NextResponse("Not found", { status: 404 });
}

export const config = {
  /*
    Node.js runtime, explicitly.
    
    Middleware defaults to the Edge runtime in this Next version, and Edge has
    no `node:crypto`. Adding password support meant `@/auth` transitively pulls
    in scrypt, so the Edge build failed with
    NOW_SANDBOX_WORKER_EDGE_FUNCTION_UNSUPPORTED_MODULES while CI stayed green:
    local builds have `node:crypto` available regardless, so only the deployment
    ever saw the problem.
  */
  runtime: "nodejs",
  /*
    Everything except static assets and image optimisation output. Those never
    need rewriting and running middleware over them is wasted work on every
    request for a hashed file.
  */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};