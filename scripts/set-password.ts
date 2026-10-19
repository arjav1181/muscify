/**
 * Set or replace a password, from the terminal.
 *
 *   npx tsx scripts/set-password.ts you@example.com
 *
 * There is no self-service reset because there is no email provider, and a reset
 * that mails a code is the only kind worth shipping. This is the supported
 * alternative: the person who runs the instance sets it.
 *
 * The password is read from stdin rather than an argument. An argument lands in
 * shell history and in `ps` output, where a prompt does not.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { PasswordStore } from "../src/lib/persistence/password-store.ts";
import { PostgresStore } from "../src/lib/persistence/postgres-store.ts";

const email = process.argv[2];
if (!email || !email.includes("@")) {
  console.error("usage: set-password.ts <email>");
  process.exit(2);
}
if (!process.env.MUSCIFY_DATABASE_URL) {
  console.error("MUSCIFY_DATABASE_URL is not set.");
  process.exit(2);
}

const rl = createInterface({ input: stdin, output: stdout });
const password = await rl.question("New password (min 10 chars): ");
rl.close();

const db = new PostgresStore(process.env.MUSCIFY_DATABASE_URL);
try {
  const existing = await db.findPasswordUser(email);
  if (!existing) {
    const created = await new PasswordStore(db).create(email, password);
    console.log(`Created an account for ${created.email}.`);
  } else {
    await new PasswordStore(db).setPassword(email, password);
    console.log(`Password updated for ${existing.email}.`);
  }
} catch (e) {
  console.error("Could not set the password:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.close();
}
