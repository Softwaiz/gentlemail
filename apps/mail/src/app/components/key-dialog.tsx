"use client";

import { Check, Copy, Plus } from "lucide-react";
import { useState } from "react";
import { createKeyAction } from "@/app/actions/admin";
import { FormError, useServerAction } from "@/app/components/action-form";
import { FormSelect, type Option } from "@/app/components/form-select";
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

/** Create an API key; the key is shown once, inside the dialog, and never put in the page or a URL. */
export function NewKeyDialog({ mailboxes, scopes }: { mailboxes: Option[]; scopes: { id: string; label: string; hint: string }[] }) {
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
      <DialogContent>
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
              <DialogDescription>Give each program its own key, so you can revoke one without touching the others.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" name="name" placeholder="Invoice agent" required autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="key-mailbox">Mailbox</Label>
              <FormSelect id="key-mailbox" name="mailbox_id" options={[{ value: "all", label: "All mailboxes" }, ...mailboxes]} defaultValue="all" />
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1.5 text-sm font-medium">Permissions</legend>
              {scopes.map((s) => (
                <label key={s.id} className="flex items-start gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-foreground/40">
                  <Checkbox name="scopes" value={s.id} defaultChecked={s.id === "send"} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block text-xs text-muted-foreground">{s.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
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
