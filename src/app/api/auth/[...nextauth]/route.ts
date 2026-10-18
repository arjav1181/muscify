import { handlers } from "@/auth";

/**
 * Auth.js endpoints: sign-in, callback, session, sign-out.
 *
 * When no provider credentials or `AUTH_SECRET` are configured, `handlers` is
 * null (see `src/auth.ts`) and this answers 404. That is deliberate: the default
 * deployment is anonymous-only, and a 404 is an honest "there is nothing here"
 * rather than a 500 that looks like a bug. The UI reads `availableProviders`
 * and does not render a sign-in link at all in that case, so nobody reaches it.
 *
 * The handlers are exported as bare references rather than wrapped. Auth.js
 * needs the exact `Request`/`Response` objects Next gives it — re-wrapping them
 * to inspect the body or add a header breaks the signature check on the
 * provider callback, which fails as a confusing 400 at the provider rather than
 * at the cause.
 */
const noAuth = () =>
  new Response("accounts are not configured on this deployment", { status: 404 });

const GET = handlers ? handlers.GET : noAuth;
const POST = handlers ? handlers.POST : noAuth;

export { GET, POST };