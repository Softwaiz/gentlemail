/*
 * The release file GentleMail instances read (apps/mail/src/lib/updates.ts) to tell their admins
 * about new versions: the repository's CHANGELOG.md as data, newest first. It only informs.
 * Merging to main deploys the docs, so it changes with each release.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Release = { version: string; date: string; sections: Record<string, string[]> };

/** Markdown kept to words: bold and code lose their marks, links their address, the pull request numbers go. */
const plain = (line: string) =>
  line
    .replace(/\s*\(\[#\d+\]\([^)]*\)(?:,\s*\[#\d+\]\([^)]*\))*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

export function parseReleases(markdown: string, max = 30): Release[] {
  const releases: Release[] = [];
  for (const part of markdown.split(/^## /m).slice(1)) {
    const head = /^(\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)/.exec(part);
    if (!head) continue; // Unreleased
    const sections: Release["sections"] = {};
    for (const section of part.split(/^### /m).slice(1)) {
      const name = section.slice(0, section.indexOf("\n")).trim();
      // A line and what continues it: wrapped text and nested lists.
      const lines = section.slice(name.length).split(/^- /m).slice(1).map(plain).filter(Boolean);
      if (lines.length) sections[name] = lines;
    }
    releases.push({ version: head[1], date: head[2], sections });
  }
  return releases.slice(0, max);
}

export const releases = () => parseReleases(readFileSync(resolve(process.cwd(), "../../CHANGELOG.md"), "utf8"));
