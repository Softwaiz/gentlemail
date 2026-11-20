// Reads and prepares releases of the mail app from CHANGELOG.md and apps/mail/package.json.
// Used by .github/workflows/release.yml; see Branches and Releases in AGENTS.md.
//
//   node .github/scripts/release.mjs version            the version in apps/mail/package.json
//   node .github/scripts/release.mjs unreleased         the lines under Unreleased
//   node .github/scripts/release.mjs notes <x.y.z>      the section of that version
//   node .github/scripts/release.mjs suggest            the next version, from what is under Unreleased
//   node .github/scripts/release.mjs prepare <x.y.z>    Unreleased becomes that version, dated today
import { readFileSync, writeFileSync } from "node:fs";

const CHANGELOG = "CHANGELOG.md";
const PACKAGE = "apps/mail/package.json";

const changelog = () => readFileSync(CHANGELOG, "utf8");
const version = () => JSON.parse(readFileSync(PACKAGE, "utf8")).version;

/** The text under "## <heading…>", up to the next "## ". */
function section(text, heading) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `## ${heading}` || l.startsWith(`## ${heading} `));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

/**
 * While GentleMail is 0.x, a minor version can hold anything and a patch only fixes
 * (AGENTS.md). So: anything added, changed or removed, or a manual step, is a minor
 * version; only fixes and security fixes are a patch. Never 1.0: that's a decision.
 */
function suggest() {
  const unreleased = section(changelog(), "Unreleased") ?? "";
  if (!/^- /m.test(unreleased)) throw new Error("Nothing under Unreleased in CHANGELOG.md: nothing to release.");
  const [major, minor, patch] = version().split(".").map(Number);
  const feature = /^### (Added|Changed|Removed|Upgrading)\s*$/m.test(unreleased);
  return feature ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

function prepare(next) {
  if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error(`Not a version: ${next}`);
  const text = changelog();
  if (section(text, next) !== null) throw new Error(`CHANGELOG.md already has a ${next} section.`);
  if (!/^- /m.test(section(text, "Unreleased") ?? "")) throw new Error("Nothing under Unreleased in CHANGELOG.md: nothing to release.");
  const date = new Date().toISOString().slice(0, 10);
  // An empty Unreleased stays on top: builds of dev show "+dev" once lines are added under it.
  writeFileSync(CHANGELOG, text.replace(/^## Unreleased[ \t]*$/m, `## Unreleased\n\n## ${next} (${date})`));
  const pkg = readFileSync(PACKAGE, "utf8");
  writeFileSync(PACKAGE, pkg.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));
}

const [command, arg] = process.argv.slice(2);
try {
  switch (command) {
    case "version":
      console.log(version());
      break;
    case "unreleased":
      console.log(section(changelog(), "Unreleased") ?? "");
      break;
    case "notes": {
      const notes = section(changelog(), arg);
      if (notes === null) throw new Error(`No ${arg} section in CHANGELOG.md.`);
      console.log(notes);
      break;
    }
    case "suggest":
      console.log(suggest());
      break;
    case "prepare":
      prepare(arg);
      break;
    default:
      throw new Error(`Unknown command: ${command ?? "(none)"}`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
