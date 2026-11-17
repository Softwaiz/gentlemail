/*
 * Changelog pages are the repository's CHANGELOG.md files, read at build time, so
 * they are never a copy that drifts. The title and the maintainers' notes above
 * the first version are left out, and an empty "Unreleased" section is hidden.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";

export const repo = "https://github.com/Softwaiz/gentlemail";

/** `file` is relative to the repository root, e.g. "CHANGELOG.md" or "packages/sdk/CHANGELOG.md". */
export async function renderChangelog(file: string) {
  // Builds run from apps/docs (npm run build there, or Workers Builds with that root directory).
  const raw = readFileSync(resolve(process.cwd(), "../..", file), "utf8");

  let md = raw.slice(raw.indexOf("\n## ") + 1); // drop the title and the maintainers' notes
  md = md.replace(/^## Unreleased\s*\n(?=## )/m, ""); // nothing unreleased: no heading
  md = md.replace(/^## Unreleased\s*$/m, "## Unreleased (on main, not yet in a release)");
  // Links relative to the file point to GitHub, next to the file.
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  md = md.replace(/\]\((?!https?:|#|\/)([^)]+)\)/g, `](${repo}/blob/main/${dir}$1)`);

  const { code, metadata } = await (await createMarkdownProcessor()).render(md);
  return { code, headings: metadata.headings.filter((h) => h.depth === 2), editUrl: `${repo}/edit/main/${file}` };
}
