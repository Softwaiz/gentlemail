// Fills the LOCAL database with made-up data, so every screen can be looked at without
// sending mail or clicking through setup: `npm run db:seed:local` (after `npm run db:migrate:local`).
//
// Sign in at http://localhost:5173 with one of these local-only accounts:
//   reviewer@example.test  (admin)   password: gentlemail-review
//   member@example.test    (member)  password: gentlemail-review
//
// Everything it adds has an id starting with "seed-" and is replaced on every run; other local
// data is left alone. It never touches a remote database (--local only).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PASSWORD = "gentlemail-review";
const DOMAIN = "example.test";
const now = Date.now();
const minutes = (n) => now - n * 60_000;
const days = (n) => now - n * 86_400_000;

const enc = new TextEncoder();
const b64 = (u) => Buffer.from(u).toString("base64");

/** Same format as hashPassword in src/lib/auth.ts. */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return `pbkdf2$100000$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}
const sha256 = async (s) => Buffer.from(await crypto.subtle.digest("SHA-256", enc.encode(s))).toString("hex");

const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
const row = (table, values) =>
  `INSERT INTO ${table} (${Object.keys(values).join(", ")}) VALUES (${Object.values(values).map(q).join(", ")});`;

const sql = [];
const tmp = mkdtempSync(join(tmpdir(), "gentlemail-seed-"));
const objects = []; // [r2 key, file] for attachments

// Clear the previous seed. Mailboxes cascade to their messages, attachments, members and rules.
sql.push(
  "DELETE FROM webhooks WHERE id LIKE 'seed-%';",
  "DELETE FROM api_keys WHERE id LIKE 'seed-%';",
  "DELETE FROM mailboxes WHERE id LIKE 'seed-%';",
  "DELETE FROM sessions WHERE user_id LIKE 'seed-%';",
  "DELETE FROM users WHERE id LIKE 'seed-%';",
  `INSERT OR IGNORE INTO domains (id, name, active, created_at) VALUES ('seed-domain', '${DOMAIN}', 1, ${days(30)});`,
);

const hash = await hashPassword(PASSWORD);
sql.push(
  row("users", { id: "seed-admin", email: `reviewer@${DOMAIN}`, name: "Rita Reviewer", password_hash: hash, role: "admin", created_at: days(30) }),
  row("users", { id: "seed-member", email: `member@${DOMAIN}`, name: "Malik Member", password_hash: hash, role: "member", created_at: days(20) }),
);

const mailboxes = [
  { id: "seed-sales", address: `sales@${DOMAIN}`, display_name: "Sales", signature: "Rita\nSales, Example", active: 1 },
  { id: "seed-team", address: `team@${DOMAIN}`, display_name: "Team", signature: "", active: 1 },
  { id: "seed-old", address: `old-newsletter-signups-2024@${DOMAIN}`, display_name: "Old sign-ups", signature: "", active: 0 },
];
for (const m of mailboxes) sql.push(row("mailboxes", { ...m, created_at: days(25) }));
for (const [mb, user] of [["seed-sales", "seed-admin"], ["seed-team", "seed-admin"], ["seed-old", "seed-admin"], ["seed-team", "seed-member"]])
  sql.push(row("mailbox_members", { mailbox_id: mb, user_id: user }));

let n = 0;
function message(mailbox, folder, m) {
  const id = `seed-msg-${++n}`;
  const out = folder === "sent";
  const text = m.text ?? "Hi,\n\nJust checking in about this. Let me know what you think.\n\nThanks";
  sql.push(
    row("messages", {
      id,
      mailbox_id: mailbox,
      thread_id: m.thread ?? `seed-thread-${n}`,
      folder,
      direction: out ? "out" : "in",
      message_id: `${id}@${DOMAIN}`,
      from_addr: out ? mailboxes.find((x) => x.id === mailbox).address : m.from,
      from_name: out ? mailboxes.find((x) => x.id === mailbox).display_name : (m.name ?? ""),
      to_json: JSON.stringify(out ? [{ name: m.name ?? "", address: m.from }] : [{ name: "", address: mailboxes.find((x) => x.id === mailbox).address }]),
      subject: m.subject,
      snippet: text.replace(/\s+/g, " ").slice(0, 140),
      text_body: text,
      html_body: m.html ?? null,
      size: text.length + (m.html?.length ?? 0) + (m.attachment ? m.attachment.body.length : 0),
      has_attachments: m.attachment ? 1 : 0,
      is_read: m.read ?? (out ? 1 : 0),
      is_starred: m.starred ? 1 : 0,
      spam_reason: m.spam ?? null,
      date: m.date,
      created_at: m.date,
    }),
  );
  if (m.attachment) {
    const attId = `seed-att-${n}`;
    const key = `att/${mailbox}/${id}/${attId}`;
    const file = join(tmp, attId);
    writeFileSync(file, m.attachment.body);
    objects.push([key, file, m.attachment.type]);
    sql.push(
      row("attachments", { id: attId, message_id: id, filename: m.attachment.name, content_type: m.attachment.type, size: m.attachment.body.length, r2_key: key, created_at: m.date }),
    );
  }
}

const newsletter = `<div style="font-family:Georgia,serif;max-width:560px;margin:auto">
<h1 style="color:#1a4d2e">This week at Northwind</h1>
<p>Three things we shipped, one thing we broke, and a <a href="https://example.com/sale">20% sale</a> that ends Friday.</p>
<img src="https://example.com/banner.png" alt="Banner" width="560">
<ul><li>Faster exports</li><li>A new dashboard</li><li>Dark mode, finally</li></ul>
<p style="font-size:12px;color:#888">You signed up at northwind.example. <a href="https://example.com/unsubscribe">Unsubscribe</a></p></div>`;

// Sales: the busy mailbox, with every kind of message.
message("seed-sales", "inbox", { from: "anna@acme.example", name: "Anna Lopez", subject: "Quote for 40 seats", date: minutes(4), thread: "seed-thread-quote" });
message("seed-sales", "sent", { from: "anna@acme.example", name: "Anna Lopez", subject: "Re: Quote for 40 seats", date: minutes(2), thread: "seed-thread-quote", text: "Hi Anna,\n\nAttached is the quote. 40 seats, yearly.\n\nRita" });
message("seed-sales", "inbox", { from: "billing@northwind.example", name: "Northwind Billing", subject: "Invoice INV-2026-0113", date: minutes(45), attachment: { name: "INV-2026-0113.pdf", type: "application/pdf", body: "%PDF-1.4\n% made-up invoice for local review\n" } });
message("seed-sales", "inbox", { from: "news@northwind.example", name: "Northwind", subject: "This week at Northwind: faster exports and a 20% sale", date: minutes(90), html: newsletter, text: "This week at Northwind. Three things we shipped..." });
message("seed-sales", "inbox", { from: "jo@verylongcompanynameincorporated.example", name: "Johanna Maximiliane von Hohenberg-Schwarzenfeld", subject: "A very long subject line that keeps going to see how the message list handles text that is far wider than the column it has to fit into", date: days(1), starred: true });
message("seed-sales", "inbox", { from: "li@beijing.example", name: "李娜", subject: "关于下周会议的安排", date: days(1) - 3_600_000, read: 1, text: "你好，\n\n下周二上午十点可以吗？\n\n李娜" });
message("seed-sales", "inbox", { from: "marc@client.example", name: "Marc Dubois", subject: "Contrat signé ✍️", date: days(2), read: 1, starred: true, text: "Bonjour Rita,\n\nVoici le contrat signé. Merci pour votre réactivité.\n\nMarc" });
for (let i = 0; i < 18; i++)
  message("seed-sales", "inbox", { from: `lead${i}@prospects.example`, name: `Lead ${i + 1}`, subject: `Interested in a demo (${i + 1})`, date: days(3 + i), read: i % 3 ? 1 : 0 });
message("seed-sales", "sent", { from: "partner@reseller.example", name: "Reseller", subject: "Partner pricing for Q1", date: days(4) });
message("seed-sales", "archive", { from: "old@client.example", name: "Old Client", subject: "Project wrap-up", date: days(40), read: 1 });
message("seed-sales", "archive", { from: "events@conf.example", name: "ConfEvents", subject: "Your ticket for Web Summit", date: days(60), read: 1, attachment: { name: "ticket.txt", type: "text/plain", body: "Ticket #8842 - local review data\n" } });
message("seed-sales", "trash", { from: "promo@deals.example", name: "Deals", subject: "Last chance: 70% off", date: days(5), read: 1 });
message("seed-sales", "spam", { from: "prince@lottery.example", name: "Lottery Office", subject: "You have WON $4,500,000", date: days(1), spam: "Failed SPF and DKIM" });
message("seed-sales", "spam", { from: "noreply@blocked.example", name: "Blocked Sender", subject: "Weekly digest", date: days(2), spam: "Sender blocked by you" });

// Team: a member can see it too.
message("seed-team", "inbox", { from: "ops@example.test", name: "Ops", subject: "Deploy window on Thursday", date: minutes(30) });
message("seed-team", "inbox", { from: "hr@example.test", name: "HR", subject: "Holiday calendar 2027", date: days(2), read: 1 });

// The turned-off mailbox keeps its old mail.
message("seed-old", "inbox", { from: "hello@startup.example", name: "Startup", subject: "Welcome to the beta!", date: days(300), read: 1 });

sql.push(row("sender_rules", { id: "seed-rule-1", mailbox_id: "seed-sales", sender: "noreply@blocked.example", kind: "block", created_at: days(10) }));

// An API key that can read Sales and send from Team, and one that was revoked.
const key = "gm_seed_review_key_not_valid_anywhere";
sql.push(
  row("api_keys", { id: "seed-key-1", name: "CRM sync", prefix: key.slice(0, 12), key_hash: await sha256(key), scopes: "read", created_by: "seed-admin", created_at: days(15), last_used_at: minutes(20) }),
  row("api_key_grants", { key_id: "seed-key-1", target_type: "mailbox", target_id: "seed-sales", can_read: 1, can_send: 0, can_organize: 1 }),
  row("api_key_grants", { key_id: "seed-key-1", target_type: "mailbox", target_id: "seed-team", can_read: 0, can_send: 1, can_organize: 0 }),
  row("api_keys", { id: "seed-key-2", name: "Old Zapier key", prefix: "gm_seed_old_", key_hash: await sha256(`${key}_old`), scopes: "send", created_by: "seed-admin", created_at: days(90), revoked_at: days(30) }),
);

// A webhook with one delivered and one failing event.
sql.push(
  row("webhooks", { id: "seed-hook-1", name: "CRM inbound", url: "https://crm.example/hooks/gentlemail", secret: "seed-secret", mailbox_id: "seed-sales", events: "message.received", active: 1, created_at: days(15) }),
  row("webhook_deliveries", { id: "seed-del-1", webhook_id: "seed-hook-1", event: "message.received", message_id: "seed-msg-1", payload: "{}", status: "success", attempts: 1, last_status: 200, created_at: minutes(4), delivered_at: minutes(4) }),
  row("webhook_deliveries", { id: "seed-del-2", webhook_id: "seed-hook-1", event: "message.received", message_id: "seed-msg-3", payload: "{}", status: "failed", attempts: 5, last_status: 502, last_error: "Bad gateway", created_at: minutes(45) }),
);

const file = join(tmp, "seed.sql");
writeFileSync(file, sql.join("\n") + "\n");
const run = (args) => execFileSync("npx", ["wrangler", ...args], { stdio: ["ignore", "ignore", "inherit"] });
run(["d1", "execute", "DB", "--local", "--file", file]);
for (const [k, f, type] of objects) run(["r2", "object", "put", `gentlemail/${k}`, "--local", "--file", f, "--content-type", type]);
console.log(`Seeded ${n} messages in ${mailboxes.length} mailboxes. Sign-in details are at the top of scripts/seed-local.mjs.`);
