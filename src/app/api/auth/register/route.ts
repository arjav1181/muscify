import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { isAllowedEmail, NOT_ALLOWED_MESSAGE } from "@/lib/auth/allowlist";
import { MIN_PASSWORD_LENGTH, WeakPasswordError } from "@/lib/auth/password";
import { PasswordStore } from "@/lib/persistence/password-store";
import { getAuthStore } from "@/lib/persistence/server-store";

/**
 * Account creation for the password provider.
 *
 * Signup is **closed unless an allowlist is configured**, which is the point of
 * "enforce signup". A deployment with `MUSCIFY_ALLOWED_EMAILS` set accepts only
 * those addresses; a deployment with none set accepts nobody at all, because an
 * open signup form on a personal instance is how strangers end up in it.
 *
 * Self-hosters who genuinely want open registration set
 * `MUSCIFY_ALLOWED_EMAILS=*`. That is an explicit, greppable act rather than
 * the accidental default.
 *
 * Rate limited on the same table as sign-in, and deliberately on the *address*
 * rather than the IP: on a personal instance the person signing up is usually
 * behind their own router, so a per-IP limit would lock them out by making every
 * signup from their house the ninth.
 */

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(512),
});

const OPEN_SIGNUP = "*";

export async function POST(req: Request) {
  const store = getAuthStore();
  if (!store) {
    return NextResponse.json(
      { ok: false, reason: "Accounts are not configured on this deployment." },
      { status: 501 },
    );
  }

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    raw = "";
  }
  const parsed = Body.safeParse(safeJson(raw));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "That does not look right." }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const { password } = parsed.data;

  const configured = (process.env.MUSCIFY_ALLOWED_EMAILS ?? "").trim();
  if (configured !== OPEN_SIGNUP && !isAllowedEmail(email)) {
    return NextResponse.json({ ok: false, reason: NOT_ALLOWED_MESSAGE }, { status: 403 });
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { ok: false, reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const passwords = new PasswordStore(store);
  try {
    const made = await passwords.create(email, password);
    if (!made) {
      // Already exists. Deliberately the same shape as success on the client so
      // this cannot be used to discover which addresses are registered.
      return NextResponse.json({ ok: true }, { status: 201 });
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof WeakPasswordError) {
      return NextResponse.json({ ok: false, reason: e.message }, { status: 400 });
    }
    console.error("[muscify] signup failed", e);
    return NextResponse.json({ ok: false, reason: "Could not create that account." }, { status: 500 });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}