/* The list of releases gentlemail.dev gives (apps/docs/src/lib/releases.ts writes it). No server code here. */

export type Release = { version: string; date: string; sections: Record<string, string[]> };

const VERSION = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;
const MAX_RELEASES = 30;
const MAX_SECTIONS = 10;
const MAX_LINES = 60;
const MAX_LINE = 2000;

/** Takes what is expected from the answer and leaves the rest: it's shown as text, whatever it holds. Newest first. */
export function parseReleases(data: unknown): Release[] {
  const list = (data as { releases?: unknown } | null)?.releases;
  if (!Array.isArray(list)) return [];
  const out: Release[] = [];
  for (const r of list.slice(0, 200) as Partial<Release>[]) {
    if (typeof r?.version !== "string" || !VERSION.test(r.version)) continue;
    const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : "";
    const sections: Release["sections"] = {};
    if (r.sections && typeof r.sections === "object" && !Array.isArray(r.sections))
      for (const [name, lines] of Object.entries(r.sections).slice(0, MAX_SECTIONS)) {
        if (!/^[A-Z][a-z]{1,29}$/.test(name) || !Array.isArray(lines)) continue;
        const kept = lines.filter((l) => typeof l === "string" && l.trim()).slice(0, MAX_LINES).map((l: string) => l.slice(0, MAX_LINE));
        if (kept.length) sections[name] = kept;
      }
    out.push({ version: r.version, date, sections });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version)).slice(0, MAX_RELEASES);
}

/** Below zero: `a` is older than `b`. A build of dev ("0.7.2+dev") counts as the release it follows. */
export function compareVersions(a: string, b: string): number {
  const x = a.split("+")[0].split(".").map(Number);
  const y = b.split("+")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

export const newerReleases = (releases: Release[], current: string) => releases.filter((r) => compareVersions(r.version, current) > 0);
