/*
 * wrangler.jsonc stays in the layout Wrangler writes.
 *
 * Wrangler lays out the whole file again when it adds something to it, such as the ID of
 * the database it creates on the first deploy. In any other layout that touches nearly
 * every line, and people's next `git pull` conflicts. See scripts/format-config.mjs.
 *
 * Only for the template: a copy with its own settings is its owner's to lay out.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { experimental_patchConfig, experimental_readRawConfig } from "wrangler";

const template = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const source = readFileSync(template, "utf8");
const { rawConfig } = experimental_readRawConfig({ config: template });

describe("wrangler.jsonc", { skip: rawConfig.name !== "my-gentlemail" && "not the template" }, () => {
  let dir, copy;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "gentlemail-config-"));
    copy = join(dir, "wrangler.jsonc");
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  /** What Wrangler writes after adding `patch` to the file. */
  const patched = (patch) => {
    copyFileSync(template, copy);
    return experimental_patchConfig(copy, patch, false);
  };

  test("is in the layout Wrangler writes (if not: npm run config:format)", () => {
    assert.equal(patched({}), source);
  });

  test("gains only the database's ID when Wrangler creates the database and the bucket", () => {
    const [db] = rawConfig.d1_databases;
    const written = patched({ d1_databases: [{ ...db, database_id: "made-up-id" }], r2_buckets: rawConfig.r2_buckets });
    const before = source.split("\n");
    const added = written.split("\n").filter((line) => !before.includes(line));
    // The line above only gains a comma.
    assert.deepEqual(added.map((line) => line.trim()), ['"migrations_dir": "migrations",', '"database_id": "made-up-id"']);
    assert.equal(written.split("\n").length, before.length + 1);
  });
});
