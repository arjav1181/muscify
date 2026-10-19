import Link from "next/link";
import { Clock } from "lucide-react";

export const metadata = { title: "Too many attempts · muscify" };

/**
 * Shown when sign-in is refused by the rate limiter rather than by a wrong
 * password.
 *
 * It exists because the alternative is telling someone their password is wrong
 * when it is right, which sends them off to reset a credential that was fine.
 * The distinction is invisible from the outside -- deliberately so, because a
 * rate limiter that explains *when* it was tripped is a rate limiter that can be
 * walked around by waiting.
 */
export default function RateLimitedPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-full bg-highlight text-sub"
      >
        <Clock size={24} />
      </span>
      <div className="space-y-2">
        <h1 className="text-title font-bold tracking-tight text-on">Too many attempts</h1>
        <p className="max-w-sm text-body leading-relaxed text-sub">
          That is several failed sign-ins in a row. Wait fifteen minutes and try again — your
          password is probably fine.
        </p>
      </div>
      <Link
        href="/signin"
        className="rounded-full border border-line px-5 py-2.5 text-label font-semibold text-sub transition hover:border-line-strong hover:text-on"
      >
        Back to sign in
      </Link>
    </main>
  );
}
