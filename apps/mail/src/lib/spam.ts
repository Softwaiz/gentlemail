import { env } from "cloudflare:workers";
import { deleteMessageForever, type MessageRow } from "./db";
import { domainOf } from "./db";
import { newId, now } from "./util";

/*
 * Spam handling.
 *
 * Cloudflare Email Routing already rejects, before mail reaches us: mail failing
 * both SPF and DKIM, mail failing the sender's DMARC policy, and senders on
 * realtime block lists. What arrives is authenticated, so the rest is about
 * mail you don't want:
 *   1. Your choices win: "Not spam" allows a sender, "Spam" blocks it (per mailbox).
 *   2. A spam flag set upstream (X-Spam-Flag: YES).
 *   3. DMARC fail that wasn't rejected (domains with p=none or p=quarantine).
 *   4. Cloudflare's spam score, only when SPAM_SCORE_THRESHOLD is set.
 * Spam older than 30 days is deleted by the cron.
 */

export const SPAM_RETENTION_DAYS = 30;

export type RuleKind = "block" | "allow";
export type SenderRule = { id: string; mailbox_id: string; sender: string; kind: RuleKind; created_at: number };

type Header = { key: string; value: string };
const header = (headers: Header[], key: string) => headers.find((h) => h.key === key)?.value ?? "";

/** Returns why the message is spam, or null when it belongs in the inbox. */
export async function spamVerdict(mailboxId: string, from: string, headers: Header[]): Promise<string | null> {
  const address = from.toLowerCase();
  const rule = await env.DB.prepare(
    `SELECT kind FROM sender_rules WHERE mailbox_id = ? AND sender IN (?, ?)
     ORDER BY CASE WHEN sender LIKE '@%' THEN 1 ELSE 0 END LIMIT 1`,
  )
    .bind(mailboxId, address, `@${domainOf(address)}`)
    .first<{ kind: RuleKind }>();
  if (rule?.kind === "allow") return null;
  if (rule?.kind === "block") return "You marked this sender as spam.";

  if (/^\s*yes/i.test(header(headers, "x-spam-flag"))) return "Flagged as spam before it reached us.";

  const auth = header(headers, "authentication-results");
  if (/\bdmarc=fail\b/i.test(auth)) return "The sender's domain didn't confirm it sent this (DMARC failed).";

  const threshold = Number(env.SPAM_SCORE_THRESHOLD);
  const score = Number(header(headers, "x-cf-spamh-score"));
  if (threshold > 0 && Number.isFinite(score) && score >= threshold) return `High spam score (${score}).`;
  return null;
}

/** Remembers a sender for a mailbox; a newer choice replaces the older one. */
export async function setSenderRule(mailboxId: string, sender: string, kind: RuleKind) {
  await env.DB.prepare(
    `INSERT INTO sender_rules (id, mailbox_id, sender, kind, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (mailbox_id, sender) DO UPDATE SET kind = excluded.kind, created_at = excluded.created_at`,
  )
    .bind(newId(), mailboxId, sender.toLowerCase(), kind, now())
    .run();
}

/** Learns from the user moving incoming mail in or out of spam. */
export async function learnFrom(messages: MessageRow[], kind: RuleKind) {
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.direction !== "in" || !m.from_addr) continue;
    const key = `${m.mailbox_id}|${m.from_addr.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await setSenderRule(m.mailbox_id, m.from_addr, kind);
  }
}

/** Cron: deletes spam older than the retention period, a batch at a time. */
export async function purgeOldSpam() {
  const cutoff = now() - SPAM_RETENTION_DAYS * 86_400_000;
  const { results } = await env.DB.prepare(
    "SELECT * FROM messages WHERE folder = 'spam' AND date < ? LIMIT 50",
  )
    .bind(cutoff)
    .all<MessageRow>();
  for (const m of results) await deleteMessageForever(m);
  return results.length;
}
