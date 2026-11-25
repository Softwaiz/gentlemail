import { env } from "cloudflare:workers";
import type { User } from "./auth";
import { newerReleases, parseReleases, type Release } from "./releases";
import { now } from "./util";

/*
 * New versions of GentleMail. About once a day the cron reads the list of releases from
 * gentlemail.dev and keeps it in settings; admins are told when one is newer than the version
 * running. Nothing is ever installed from here, and the list holds nothing but words.
 *
 * In settings: 'update_check' = '0' when turned off, 'update_releases' = what was read last,
 * 'update_later:<user>' = the version that person closed the notice for.
 */

const SOURCE = "https://gentlemail.dev/docs/releases.json";
const EVERY = 23 * 3600_000; // the cron looks once an hour: about once a day
const MAX_BYTES = 200_000;
const TIMEOUT = 10_000;

const laterKey = (userId: string) => `update_later:${userId}`;

const save = (key: string, value: string) =>
  env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value);

async function read(...keys: string[]): Promise<Map<string, string>> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();
  return new Map(results.map((r) => [r.key, r.value]));
}

type Stored = { checked_at: number; releases: unknown };
const parseStored = (json: string | undefined): Stored | null => {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};

/** Reads the list of releases, unless it's turned off or was read less than a day ago. Never throws: GentleMail works without it. */
export async function checkForUpdates({ force = false } = {}): Promise<void> {
  try {
    const saved = await read("update_check", "update_releases");
    if (saved.get("update_check") === "0") return;
    const last = parseStored(saved.get("update_releases"))?.checked_at ?? 0;
    if (!force && now() - last < EVERY) return;
    const res = await fetch(SOURCE, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new Error(`answered ${res.status}`);
    }
    const releases = parseReleases(JSON.parse(await readText(res.body)));
    if (!releases.length) throw new Error("no release in the answer");
    // What's running changes with a deploy: keep only what could still be news, so the row stays small.
    await save("update_releases", JSON.stringify({ checked_at: now(), releases: newerReleases(releases, __APP_VERSION__) } satisfies Stored)).run();
  } catch (e) {
    console.warn("update check failed", e instanceof Error ? e.message : e);
  }
}

async function readText(body: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new Error("answer too large");
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

export type UpdateNews = { current: string; releases: Release[]; /** This person already closed the notice for it. */ later: boolean };

/** The releases newer than the one running, newest first, for an admin. Null: nothing new, turned off, or not an admin. */
export async function updateNews(user: User): Promise<UpdateNews | null> {
  if (user.role !== "admin" || user.mustSetUpMfa) return null;
  const saved = await read("update_check", "update_releases", laterKey(user.id));
  if (saved.get("update_check") === "0") return null;
  const releases = newerReleases(parseReleases(parseStored(saved.get("update_releases"))), __APP_VERSION__);
  if (!releases.length) return null;
  return { current: __APP_VERSION__, releases, later: saved.get(laterKey(user.id)) === releases[0].version };
}

export async function closeUpdateNews(userId: string, version: string): Promise<void> {
  await save(laterKey(userId), version).run();
}

export const forgetUpdateNews = (userId: string) => env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(laterKey(userId));

export async function isUpdateCheckOn(): Promise<boolean> {
  return (await read("update_check")).get("update_check") !== "0";
}

export async function setUpdateCheck(on: boolean): Promise<void> {
  await save("update_check", on ? "1" : "0").run();
  if (on) await checkForUpdates({ force: true });
  else await env.DB.prepare("DELETE FROM settings WHERE key = 'update_releases'").run();
}
