import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./password.ts";

/**
 * The properties that matter, rather than the shape of the output.
 *
 * A hash test that only asserts "hash != password" passes for a broken scheme
 * and fails for a good one. These assert the things that would actually be a
 * vulnerability: that a wrong password does not verify, that a salt is random,
 * that a malformed stored value cannot crash the verifier, and that parameters
 * travel with the hash so they can be raised later.
 */
describe("password hashing", () => {
  test("a correct password verifies", async () => {
    const h = await hashPassword("correct horse battery");
    assert.equal(await verifyPassword("correct horse battery", h), true);
  });

  test("a wrong password does not verify", async () => {
    const h = await hashPassword("correct horse battery");
    assert.equal(await verifyPassword("correct horse batterY", h), false);
  });

  test("the hash never contains the password", async () => {
    const pw = "a-very-distinctive-passphrase";
    const h = await hashPassword(pw);
    assert.ok(!h.includes(pw));
    assert.ok(!h.includes(pw.slice(0, 12)));
  });

  test("two hashes of the same password differ (random salt)", async () => {
    const a = await hashPassword("same password here");
    const b = await hashPassword("same password here");
    assert.notEqual(a, b, "identical hashes mean no salt");
  });

  test("the format carries its own cost parameters", async () => {
    const h = await hashPassword("parameterised hashing");
    const [scheme, n, r, p, salt, hash] = h.split("$");
    assert.equal(scheme, "scrypt");
    assert.ok(Number(n) >= 2);
    assert.ok(Number(r) >= 1);
    assert.ok(Number(p) >= 1);
    assert.ok(salt.length > 10 && hash.length > 10);
  });

  test("the stored parameters are the ones actually used", async () => {
    // If the verifier hardcoded N instead of reading it from the stored string,
    // this would still pass. It must NOT verify: different parameters are a
    // different function, so the outputs legitimately differ.
    //
    // That is the property worth asserting. It is what makes raising N later a
    // safe change for new hashes while old ones keep verifying against the
    // parameters they were made with.
    const h = await hashPassword("portable hash");
    const parts = h.split("$");
    const weaker = [parts[0], "1024", parts[2], parts[3], parts[4], parts[5]].join("$");
    assert.equal(await verifyPassword("portable hash", weaker), false);
    // ...and the original still verifies, untouched by the edit.
    assert.equal(await verifyPassword("portable hash", h), true);
  });

  test("malformed stored values return false rather than throwing", async () => {
    const bad = ["", "nonsense", "scrypt", "scrypt$1$2$3", "bcrypt$x$y$z$w$v", "scrypt$a$b$c$d$e"];
    for (const value of bad) {
      assert.equal(await verifyPassword("whatever", value), false, `accepted: ${value}`);
    }
  });

  test("a hostile N cannot request an unbounded amount of memory", async () => {
    // A stored value is data. Without a bound, `scrypt$99999999$...` would be a
    // denial of service triggered by writing one row.
    const h = await hashPassword("bounded parameters");
    const parts = h.split("$");
    const evil = [parts[0], "99999999", parts[2], parts[3], parts[4], parts[5]].join("$");
    assert.equal(await verifyPassword("bounded parameters", evil), false);
  });

  test("passwords shorter than the minimum are refused", async () => {
    await assert.rejects(() => hashPassword("short"), /at least/);
  });

  test("the minimum is enforced, not just documented", async () => {
    const ok = "a".repeat(MIN_PASSWORD_LENGTH);
    assert.equal(await verifyPassword(ok, await hashPassword(ok)), true);
    await assert.rejects(() => hashPassword("a".repeat(MIN_PASSWORD_LENGTH - 1)));
  });

  test("hashing is slow enough to be a real cost", async () => {
    const t0 = Date.now();
    await hashPassword("timing check password");
    const ms = Date.now() - t0;
    assert.ok(ms >= 20, `scrypt finished in ${ms}ms, which is too fast to be memory-hard`);
  });
});