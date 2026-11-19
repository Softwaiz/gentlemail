import type { AccessTargets, AccessValue } from "@/app/components/key-dialog";
import type { Grant } from "@/lib/apikeys";
import { cn } from "@/lib/utils";

/* What a key or a connected assistant may reach, in a few lines. */

export const grantKey = (g: Grant) => (g.target_type === "all" ? "all" : `${g.target_type}:${g.target_id}`);
export const grantValue = (grants: Grant[]): AccessValue =>
  Object.fromEntries(grants.map((g) => [grantKey(g), { read: !!g.can_read, organize: !!g.can_organize, send: !!g.can_send }]));

/** What each grant target is called, by grantKey(): "domain:<id>" → "All of example.com", "mailbox:<id>" → its address. */
export const targetNames = (targets: AccessTargets) =>
  new Map<string, string>([
    ...targets.domains.map((d) => [`domain:${d.id}`, `All of ${d.name}`] as const),
    ...targets.mailboxes.map((m) => [`mailbox:${m.id}`, m.address] as const),
  ]);

/** One line per grant, broadest first: "All mailboxes · read, organize, send". */
export function AccessSummary({ grants, names }: { grants: Grant[]; names: Map<string, string> }) {
  const order = { all: 0, domain: 1, mailbox: 2 } as const;
  const name = (g: Grant) =>
    g.target_type === "all"
      ? "All mailboxes"
      : (names.get(grantKey(g)) ?? (g.target_type === "domain" ? "a removed domain" : "a deleted mailbox"));
  const sorted = [...grants].sort((a, b) => order[a.target_type] - order[b.target_type]);
  if (!sorted.length) return <span className="text-muted-foreground">No access</span>;
  const shown = sorted.slice(0, 3);
  return (
    <ul className="grid gap-0.5">
      {shown.map((g) => (
        <li key={grantKey(g)} className="text-[13px]">
          <span className={cn(g.target_type !== "mailbox" && "font-medium")}>{name(g)}</span>
          <span className="text-muted-foreground">
            {" · "}
            {[g.can_read && "read", g.can_organize && "organize", g.can_send && "send"].filter(Boolean).join(", ")}
          </span>
        </li>
      ))}
      {sorted.length > shown.length && <li className="text-xs text-muted-foreground">+{sorted.length - shown.length} more</li>}
    </ul>
  );
}
