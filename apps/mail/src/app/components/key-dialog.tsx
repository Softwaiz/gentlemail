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
import type { MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { i18n } from "@/lib/i18n";

export type AccessTargets = {
  domains: { id: string; name: string }[];
  mailboxes: { id: string; address: string }[];
};
/** "all" | "domain:<id>" | "mailbox:<id>" → permissions granted directly on it. */
export type AccessValue = Record<string, Record<Perm, boolean>>;

/** The permissions, in column order (the server's Scope; kept here, as this file runs in the browser). */
type Perm = "read" | "organize" | "send";
const PERMS: { perm: Perm; label: MessageDescriptor }[] = [
  { perm: "read", label: msg({ id: "keys.read", message: "Read" }) },
  { perm: "organize", label: msg({ id: "keys.organize", message: "Organize" }) },
  { perm: "send", label: msg({ id: "keys.send", message: "Send" }) },
];
const NONE: Record<Perm, boolean> = { read: false, organize: false, send: false };
/** An address may wrap after its "@" (on phones) rather than mid-word. */
const breakAfterAt = (text: string) => {
  const at = text.indexOf("@");
  return at < 0 ? text : (
    <>
      {text.slice(0, at + 1)}
      <wbr />
      {text.slice(at + 1)}
    </>
  );
};
/** Narrower on phones, where a name may wrap rather than be cut off (see row()). */
const COLUMNS = "grid-cols-[minmax(0,1fr)_repeat(3,52px)] sm:grid-cols-[minmax(0,1fr)_repeat(3,64px)]";

/**
 * Read / Organize / Send per line: every mailbox, each domain (mailboxes added
 * to it later included) and each mailbox. A line already covered by a broader
 * one shows as ticked and locked. Posts checkboxes named after each permission; the server
 * replaces all of a key's grants with what is posted, so every grant must be
 * in the form: the filter only hides rows, and a locked line still posts its
 * own grant, so removing the broader line later leaves it in place.
 */
export function AccessEditor({
  targets,
  initial,
  allowAll = true,
}: {
  targets: AccessTargets;
  initial: AccessValue;
  /** Offer the "All mailboxes" line (not to someone who can open only some mailboxes). */
  allowAll?: boolean;
}) {
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
    setValue((v) => ({ ...v, [t]: { ...NONE, ...v[t], [p]: on } }));

  const cell = (target: string, perm: Perm, inherited: boolean, label: string) =>
    inherited ? (
      <>
        <Checkbox checked disabled aria-label={t({ id: "keys.included", message: `${label}: included by a broader line` })} />
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
      className={cn("grid items-center gap-2 px-3 py-2", COLUMNS, level === 0 ? "bg-muted/40" : "pl-5 sm:pl-7", hidden && "hidden")}
    >
      <div className="min-w-0">
        <div className={cn("text-sm max-sm:[overflow-wrap:anywhere] sm:truncate", level === 0 && "font-medium")}>{breakAfterAt(title)}</div>
        {hint && <div className="text-xs text-muted-foreground max-sm:[overflow-wrap:anywhere] sm:truncate">{hint}</div>}
      </div>
      {PERMS.map(({ perm, label }) => (
        <div key={perm} className="grid place-items-center">
          {cell(target, perm, inherited[perm], `${title}: ${i18n._(label)}`)}
        </div>
      ))}
    </div>
  );

  const allOn = Object.fromEntries(PERMS.map(({ perm }) => [perm, own("all", perm)])) as Record<Perm, boolean>;
  return (
    <div className="grid gap-2">
      {targets.mailboxes.length > 8 && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t({ id: "keys.filter_mailboxes", message: "Filter mailboxes" })} aria-label={t({ id: "keys.filter_mailboxes", message: "Filter mailboxes" })} className="pl-8" />
        </div>
      )}
      <div className="overflow-hidden rounded-md border">
        <div className={cn("grid gap-2 border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground sm:text-xs", COLUMNS)}>
          <span>{t({ id: "keys.access", message: "Access to" })}</span>
          {PERMS.map(({ perm, label }) => (
            <span key={perm} className="text-center">
              {i18n._(label)}
            </span>
          ))}
        </div>
        <div className="max-h-[45vh] divide-y overflow-y-auto">
          {allowAll &&
            row({ target: "all", title: t({ id: "keys.all_mailboxes", message: "All mailboxes" }), hint: t({ id: "keys.every_mailbox_now_later", message: "Every mailbox, now and later" }), inherited: NONE, level: 0 })}
          {groups.map((g) => {
            const dKey = g.domain ? `domain:${g.domain.id}` : "";
            const dInherited = allOn;
            const mInherited = Object.fromEntries(
              PERMS.map(({ perm }) => [perm, allOn[perm] || (!!g.domain && own(dKey, perm))]),
            ) as Record<Perm, boolean>;
            // Filtered-out rows are hidden, not removed, so their grants are still posted.
            const matches = (m: { address: string }) => !q || m.address.toLowerCase().includes(q);
            const groupHidden = !!q && !g.mailboxes.some(matches) && !g.domain?.name.toLowerCase().includes(q);
            return (
              <div key={dKey || "other"} className={cn("divide-y", groupHidden && "hidden")}>
                {g.domain ? (
                  row({
                    target: dKey,
                    title: t({ id: "access.all_of", message: `All of ${g.domain.name}` }),
                    hint: t({ id: "keys.includes_mailboxes_added_domain", message: "Includes mailboxes added to this domain later" }),
                    inherited: dInherited,
                    level: 0,
                  })
                ) : (
                  <div className="bg-muted/40 px-3 py-2 text-sm font-medium">{targets.domains.length
                      ? t({ id: "keys.other_mailboxes", message: "Other mailboxes" })
                      : allowAll
                        ? t({ id: "keys.mailboxes", message: "Mailboxes" })
                        : t({ id: "keys.your_mailboxes", message: "Your mailboxes" })}</div>
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
        <Trans id="keys.perms_help">
          <strong className="font-medium text-foreground">Read</strong>: search and read messages and attachments.{" "}
          <strong className="font-medium text-foreground">Organize</strong>: mark read or unread, star, archive, move to spam or trash.{" "}
          <strong className="font-medium text-foreground">Send</strong>: send from the mailbox.
        </Trans>
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
          <Plus /> {t({ id: "keys.new_key", message: "New key" })}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        {created ? (
          <div className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{t({ id: "keys.copy_key", message: "Copy your key" })}</DialogTitle>
              <DialogDescription>
                This is the only time “{created.name}” is shown. Only a fingerprint is stored, so keep it in your program's secrets now.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Input readOnly value={created.key} aria-label={t({ id: "keys.new_api_key", message: "New API key" })} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button
                type="button"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(created.key).then(() => setCopied(true))}
              >
                {copied ? <Check /> : <Copy />} {copied ? t({ id: "common.copied", message: "Copied" }) : t({ id: "common.copy", message: "Copy" })}
              </Button>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">{t({ id: "keys.done", message: "Done" })}</Button>
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
              <DialogTitle>{t({ id: "keys.new_api_key", message: "New API key" })}</DialogTitle>
              <DialogDescription>{t({ id: "keys.give_each_program_own", message: "Give each program its own key and only the access it needs. You can change it later." })}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="key-name">{t({ id: "keys.name", message: "Name" })}</Label>
              <Input id="key-name" name="name" placeholder={t({ id: "keys.invoice_agent", message: "Invoice agent" })} required autoFocus />
            </div>
            <AccessEditor targets={targets} initial={{}} />
            <FormError error={error} />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t({ id: "keys.cancel", message: "Cancel" })}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? t({ id: "keys.creating", message: "Creating…" }) : t({ id: "keys.create", message: "Create key" })}
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
          {t({ id: "keys.edit_access", message: "Edit access" })}
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
            <DialogDescription>{t({ id: "keys.programs_using_key_keep", message: "Programs using this key keep the same key; the new access applies from their next request." })}</DialogDescription>
          </DialogHeader>
          {/* Remount with fresh values each time the dialog opens. */}
          {open && <AccessEditor targets={targets} initial={initial} />}
          <FormError error={error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t({ id: "keys.cancel", message: "Cancel" })}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? t({ id: "common.saving", message: "Saving…" }) : t({ id: "keys.save_access", message: "Save access" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
