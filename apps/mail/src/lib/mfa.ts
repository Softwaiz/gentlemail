import { env } from "cloudflare:workers";
import { renderSVG } from "uqr";
import { sha256 } from "./auth";
import { now } from "./util";

/*
 * Two-step verification: time-based one-time codes (RFC 6238, SHA-1, 6 digits,
 * 30 seconds, what every authenticator app uses) and single-use recovery codes.
 */

const STEP = 30;
const DIGITS = 6;
/** Codes from one step before or after are accepted, for clocks a little off. */
const WINDOW = 1;
const RECOVERY_CODES = 10;

/* ---------- Base32 (RFC 4648), the format authenticator apps expect ---------- */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/* ---------- TOTP ---------- */

/** A new 160-bit secret, base32. */
export const newTotpSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

const currentStep = () => Math.floor(now() / 1000 / STEP);

async function codeAt(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", base32Decode(secret) as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = mac[mac.length - 1] & 15;
  const bin = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * The step the code belongs to, or null when it's wrong. Steps at or before
 * `lastStep` are refused, so a code can't be used twice.
 */
export async function matchTotp(secret: string, code: string, lastStep: number | null): Promise<number | null> {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const s = currentStep();
  for (let step = s - WINDOW; step <= s + WINDOW; step++) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(await codeAt(secret, step), c)) return step;
  }
  return null;
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The otpauth:// link an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP) });
  return `otpauth://totp/${label}?${q}`;
}

/** The QR code as a data: URL for an <img> (allowed by the CSP's img-src data:). */
export function qrDataUrl(text: string) {
  const svg = renderSVG(text, { border: 2, pixelSize: 6 });
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** Secret shown for typing in by hand: groups of four. */
export const formatSecret = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

/* ---------- Recovery codes ---------- */

// No 0/O, 1/l/i: easy to read back from paper.
const RC_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");

function newRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = [...bytes].map((b) => RC_ALPHABET[b % RC_ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** Replaces the user's recovery codes; returns the new codes (shown once, only hashes are kept). */
export async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").bind(userId),
    ...(await Promise.all(
      codes.map(async (c) =>
        env.DB.prepare("INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)").bind(userId, await sha256(normalizeRecovery(c))),
      ),
    )),
  ]);
  return codes;
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/* ---------- Checking a code for a user ---------- */

type MfaRow = { mfa_secret: string | null; mfa_enabled_at: number | null; mfa_last_step: number | null };

/**
 * Accepts either a 6-digit code from the app or an unused recovery code, and
 * uses it up. `pendingSetup` checks the secret being set up (not yet enabled).
 */
export async function verifySecondFactor(
  userId: string,
  input: string,
  opts: { pendingSetup?: boolean; allowRecovery?: boolean } = {},
): Promise<{ ok: true; usedRecovery: boolean } | { ok: false }> {
  const user = await env.DB.prepare("SELECT mfa_secret, mfa_enabled_at, mfa_last_step FROM users WHERE id = ?").bind(userId).first<MfaRow>();
  if (!user?.mfa_secret || (!opts.pendingSetup && !user.mfa_enabled_at)) return { ok: false };

  const step = await matchTotp(user.mfa_secret, input, user.mfa_last_step);
  if (step !== null) {
    // Conditional update: two requests racing with the same code can't both pass.
    const r = await env.DB.prepare("UPDATE users SET mfa_last_step = ? WHERE id = ? AND (mfa_last_step IS NULL OR mfa_last_step < ?)")
      .bind(step, userId, step)
      .run();
    return r.meta.changes === 1 ? { ok: true, usedRecovery: false } : { ok: false };
  }

  if (opts.allowRecovery && normalizeRecovery(input).length === 10) {
    const r = await env.DB.prepare("UPDATE mfa_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL")
      .bind(now(), userId, await sha256(normalizeRecovery(input)))
      .run();
    if (r.meta.changes === 1) return { ok: true, usedRecovery: true };
  }
  return { ok: false };
}

/* ---------- Settings ---------- */

export async function isMfaRequired(): Promise<boolean> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'require_mfa'").first<{ value: string }>();
  return row?.value === "1";
}
