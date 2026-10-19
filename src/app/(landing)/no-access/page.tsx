import Link from "next/link";
import { ShieldOff } from "lucide-react";

export const metadata = { title: "No access · muscify" };

/**
 * Shown when a valid sign-in is refused by the allowlist.
 *
 * Deliberately says the address is not on the list, and nothing about who *is*.
 * A message that named the allowed addresses would hand a stranger the owner's
 * email. Equally, it does not confirm the address exists anywhere else.
 */
export default function NoAccessPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-full bg-highlight text-sub"
      >
        <ShieldOff size={24} />
      </span>
      <div className="space-y-2">
        <h1 className="text-title font-bold tracking-tight text-on">Not on the list</h1>
        <p className="max-w-sm text-body leading-relaxed text-sub">
          Your sign-in worked, but this address is not on this instance&apos;s list. If you think that
          is wrong, ask whoever runs it to add you.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-full border border-line px-5 py-2.5 text-label font-semibold text-sub transition hover:border-line-strong hover:text-on"
      >
        Back
      </Link>
    </main>
  );
}
