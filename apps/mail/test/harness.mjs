/*
 * Runs the built Worker (dist/, from `vite build`) in Miniflare (workerd, the Workers runtime) with an
 * in-memory D1 database and R2 bucket, the migrations applied. Shared by the tests in this folder.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";

export const APP = new URL("..", import.meta.url).pathname;
export const BASE = "http://gentlemail.test";

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** A SQL literal, for seed statements. */
export const q = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

/** The migrations, one statement at a time (they hold no triggers, so ";" at a line end ends a statement). */
function migrationStatements() {
  const dir = join(APP, "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) =>
      readFileSync(join(dir, f), "utf8")
        .replace(/--.*$/gm, "")
        .split(/;\s*$/m)
        .map((st) => st.trim())
        .filter(Boolean),
    );
}

/** Starts the Worker with the migrations and `seed` (SQL statements, one per line ending in ";") applied. */
export async function startWorker(seed) {
  const config = JSON.parse(readFileSync(join(APP, "dist/worker/wrangler.json"), "utf8"));
  const mf = new Miniflare({
    scriptPath: join(APP, "dist/worker", config.main),
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js", "**/*.mjs"] }],
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    bindings: { ...config.vars, PUBLIC_URL: BASE },
    d1Databases: { DB: "test" },
    r2Buckets: { MAIL_BUCKET: "test" },
    email: { send_email: [{ name: "EMAIL" }] },
    ratelimits: Object.fromEntries((config.ratelimits ?? []).map((r) => [r.name, { namespace_id: r.namespace_id, simple: r.simple }])),
  });
  const db = await mf.getD1Database("DB");
  await db.batch([...migrationStatements(), ...seed.split(/;\n/)].filter((st) => st.trim()).map((st) => db.prepare(st)));
  return { mf, db, request: (path, init) => mf.dispatchFetch(BASE + path, { redirect: "manual", ...init }) };
}
