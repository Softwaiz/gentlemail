"use client";

import { Check, Copy, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { createKeyAction, updateKeyAccessAction } from "@/app/actions/admin";
import { FormError, useServerAction } from "@/app/components/action-form";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { domainOf } from "@/lib/util";
import { cn } from "@/lib/utils";

export type AccessTargets = {
  domains: { id: string; name: string }[];
  mailboxes: { id: string; address: string }[];
};
/** "all" | "domain:<id>" | "mailbox:<id>" → permissions granted directly on it. */
export type AccessValue = Record<string, { read: boolean; send: boolean }>;

type Perm = "read" | "send";

/**
 * Read / Send per line: every mailbox, each domain (mailboxes added to it later
 * included) and each mailbox. A line already covered by a broader one shows as
 * ticked and locked. Posts checkboxes named "read" and "send"; the server
 * replaces all of a key's grants with what is posted, so every grant must be
 * in the form: the filter only hides rows, and a locked line still posts its
 * own grant, so removing the broader line later leaves it in place.
 */
function AccessEditor({ targets, initial }: { targets: AccessTargets; initial: AccessValue }) {
  const [value, setValue] = useState<AccessValue>(initial);
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    const byName = new Map(targets.domains.map((d) => [d.name.toLowerCase(), d]));
    const out = targets.domains.map((d) => ({ domain: d as { id: string; name: string } | null, mailboxes: [] as AccessTargets["mailboxes"] }));
    const groupOf = new Map(out.map((g) => [g.domain!.id, g]));
    const other: AccessTargets["mailboxes"] = [];
    for (const m of targets.mailboxes) {
      const d = byName.get(domainOf(m.address));
      if (d) groupOf.get(d.id)!.mailboxes.push(m);
      else other.push(m);
    }
    if (other.length) out.push({ domain: null, mailboxes: other });
    return out;
  }, [targets]);

  const q = filter.trim().toLowerCase();
  const own = (t: string, p: Perm) => !!value[t]?.[p];
  const toggle = (t: string, p: Perm, on: boolean) =>
    setValue((v) => ({ ...v, [t]: { ...(v[t] ?? { read: false, send: false }), [p]: on } }));

  const cell = (target: string, perm: Perm, inherited: boolean, label: string) =>
    inherited ? (
      <>
        <Checkbox checked disabled aria-label={`${label}: included by a broader line`} />
        {own(target, perm) && <input type="hidden" name={perm} value={target} />}
      </>
    ) : (
      <Checkbox name={perm} value={target} checked={own(target, perm)} onCheckedChange={(c) => toggle(target, perm, c === true)} aria-label={label} />
    );

  const row = ({
    target,
    title,
    hint,
    inherited,
    level,
    hidden = false,
  }: {
    target: string;
    title: string;
    hint?: string;
    inherited: Record<Perm, boolean>;
    level: 0 | 1;
    hidden?: boolean;
  }) => (
    <div
      key={target}
      className={cn("grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-2 px-3 py-2", level === 0 ? "bg-muted/40" : "pl-7", hidden && "hidden")}
    >
      <div className="min-w-0">
        <div className={cn("truncate text-sm", level === 0 && "font-medium")}>{title}</div>
        {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="grid place-items-center">
        {cell(target, "read", inherited.read, `${title}: read`)}
      </div>
      <div className="grid place-items-center">
        {cell(target, "send", inherited.send, `${title}: send`)}
      </div>
    </div>
  );

  const allOn = { read: own("all", "read"), send: own("all", "send") };
  return (
    <div className="grid gap-2">
      {targets.mailboxes.length > 8 && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter mailboxes" aria-label="Filter mailboxes" className="pl-8" />
        </div>
      )}
      <div className="overflow-hidden rounded-md border">
        <div className="grid grid-cols-[minmax(0,1fr)_56px_56px] gap-2 border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <span>Access to</span>
          <span className="text-center">Read</span>
          <span className="text-center">Send</span>
        </div>
        <div className="max-h-[45vh] divide-y overflow-y-auto">
          {row({ target: "all", title: "All mailboxes", hint: "Every mailbox, now and later", inherited: { read: false, send: false }, level: 0 })}
          {groups.map((g) => {
            const dKey = g.domain ? `domain:${g.domain.id}` : "";
            const dInherited = allOn;
            const mInherited = {
              read: allOn.read || (!!g.domain && own(dKey, "read")),
              send: allOn.send || (!!g.domain && own(dKey, "send")),
            };
            // Filtered-out rows are hidden, not removed, so their grants are still posted.
            const matches = (m: { address: string }) => !q || m.address.toLowerCase().includes(q);
            const groupHidden = !!q && !g.mailboxes.some(matches) && !g.domain?.name.toLowerCase().includes(q);
            return (
              <div key={dKey || "other"} className={cn("divide-y", groupHidden && "hidden")}>
                {g.domain ? (
                  row({
                    target: dKey,
                    title: `All of ${g.domain.name}`,
                    hint: "Includes mailboxes added to this domain later",
                    inherited: dInherited,
                    level: 0,
                  })
                ) : (
                  <div className="bg-muted/40 px-3 py-2 text-sm font-medium">Other mailboxes</div>
                )}
                {g.mailboxes.map((m) =>
                  row({ target: `mailbox:${m.id}`, title: m.address, inherited: mInherited, level: 1, hidden: !matches(m) }),
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        <strong className="font-medium text-foreground">Read</strong>: list and read messages and attachments, mark read, archive.{" "}
        <strong className="font-medium text-foreground">Send</strong>: send from the mailbox.
      </p>
    </div>
  );
}

/** Create an API key; the key is shown once, inside the dialog, and never put in the page or a URL. */
export function NewKeyDialog({ targets }: { targets: AccessTargets }) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { run, pending, error, setError } = useServerAction(createKeyAction, {
    onSuccess: (r) => r.data && setCreated(r.data),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setCreated(null);
          setCopied(false);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> New key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        {created ? (
          <div className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Copy your key</DialogTitle>
              <DialogDescription>
                This is the only time “{created.name}” is shown. Only a fingerprint is stored, so keep it in your program's secrets now.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Input readOnly value={created.key} aria-label="New API key" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button
                type="button"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(created.key).then(() => setCopied(true))}
              >
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              run(new FormData(e.currentTarget));
            }}
          >
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>Give each program its own key and only the access it needs. You can change it later.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" name="name" placeholder="Invoice agent" required autoFocus />
            </div>
            <AccessEditor targets={targets} initial={{}} />
            <FormError error={error} />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Change what an existing key can read and send. */
export function EditKeyAccessDialog({
  keyId,
  name,
  targets,
  initial,
}: {
  keyId: string;
  name: string;
  targets: AccessTargets;
  initial: AccessValue;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending, error, setError } = useServerAction(updateKeyAccessAction, { onSuccess: () => setOpen(false) });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Edit access
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            run(keyId, new FormData(e.currentTarget));
          }}
        >
          <DialogHeader>
            <DialogTitle>Access for “{name}”</DialogTitle>
            <DialogDescription>Programs using this key keep the same key; the new access applies from their next request.</DialogDescription>
          </DialogHeader>
          {/* Remount with fresh values each time the dialog opens. */}
          {open && <AccessEditor targets={targets} initial={initial} />}
          <FormError error={error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save access"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
