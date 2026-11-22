// Sign-in pages: messages are chosen by the server, never read as text from the URL, and a
// wrong password comes back with the email still filled in.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { q, sha256, startWorker } from "./harness.mjs";

const SESSION = "session-auth-test";
const PLANTED = "Your account is locked. Call +1 555 0100 to unlock it.";

function seedSql() {
  const t = Date.now();
  return [
    // A hash nothing matches: every password is wrong.
    `INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('u1', 'u1@alpha.test', 'U', 'x', 'admin', ${t});`,
    `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${q(sha256(SESSION))}, 'u1', ${t + 3600e3}, ${t});`,
  ].join("\n");
}

let mf, request;
before(async () => ({ mf, request } = await startWorker(seedSql())));
after(() => mf?.dispose());

const page = async (path, init) => {
  const res = await request(path, init);
  return { status: res.status, location: res.headers.get("Location"), html: await res.text() };
};

describe("messages come from the server, not the link", () => {
  test("text put in ?err= on the sign-in page isn't shown", async () => {
    const { status, html } = await page(`/login?err=${encodeURIComponent(PLANTED)}`);
    assert.equal(status, 200);
    assert.ok(!html.includes("Call +1 555"), "the planted text must not appear");
    assert.ok(!html.includes('role="alert"'), "no error box at all");
  });

  test("a known code shows its own words", async () => {
    const { html } = await page("/login?err=signin_timeout");
    assert.ok(html.includes("Your sign-in timed out. Enter your password again."));
  });

  test("text put in ?msg= or ?err= on a signed-in page isn't shown", async () => {
    for (const kind of ["msg", "err"]) {
      const { status, html } = await page(`/account/security?${kind}=${encodeURIComponent(PLANTED)}`, {
        headers: { Cookie: `kb_session=${SESSION}` },
      });
      assert.equal(status, 200);
      assert.ok(!html.includes("Call +1 555"), `?${kind}= must not appear`);
    }
  });
});

describe("a wrong password", () => {
  const signIn = () =>
    page("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://gentlemail.test" },
      body: new URLSearchParams({ email: "u1@alpha.test", password: "wrong-password", next: "/" }),
    });

  test("answers 401 on the same page, without a redirect", async () => {
    const { status, location, html } = await signIn();
    assert.equal(status, 401);
    assert.equal(location, null);
    assert.ok(html.includes("Wrong email or password."));
  });

  test("keeps the email, empties the password and marks both fields", async () => {
    const { html } = await signIn();
    const email = html.match(/<input[^>]*name="email"[^>]*>/)?.[0] ?? "";
    const password = html.match(/<input[^>]*name="password"[^>]*>/)?.[0] ?? "";
    assert.match(email, /value="u1@alpha.test"/);
    assert.doesNotMatch(password, /value=/);
    assert.match(password, /autofocus/i);
    for (const field of [email, password]) {
      assert.match(field, /aria-invalid="true"/);
      assert.match(field, /aria-describedby="auth-error"/);
    }
  });
});
