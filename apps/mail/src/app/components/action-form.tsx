"use client";

import { useState, useTransition } from "react";
import { navigate } from "rwsdk/client";
import { toast } from "sonner";
import type { ActionResult } from "@/app/actions/guards";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { Switch } from "@/app/components/ui/switch";
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
import { cn } from "@/lib/utils";

type Action<A extends unknown[], T> = (...args: A) => Promise<ActionResult<T>>;

/**
 * Runs a server action and handles its result the same way everywhere:
 * error → kept for the form, success → toast, then optional redirect.
 * The page itself re-renders with fresh data (that's what serverAction does).
 */
export function useServerAction<A extends unknown[], T>(
  action: Action<A, T>,
  opts: {
    onSuccess?: (r: Extract<ActionResult<T>, { ok: true }>) => void;
    /** Show errors as a toast instead of keeping them for a form. */
    toastErrors?: boolean;
  } = {},
) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (...args: A) =>
    start(async () => {
      setError(null);
      let r: ActionResult<T> | undefined;
      try {
        r = await action(...args);
      } catch {
        r = { ok: false, error: "Something went wrong. Check your connection and try again." };
      }
      if (!r) return;
      if (!r.ok) {
        if (opts.toastErrors) toast.error(r.error);
        else setError(r.error);
        return;
      }
      if (r.message) toast.success(r.message);
      opts.onSuccess?.(r);
      if (r.redirect) await navigate(r.redirect);
    });
  return { run, pending, error, setError };
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  );
}

/** A form that posts its FormData to a server action. Inputs keep their values when the action fails. */
export function ActionForm({
  action,
  children,
  className,
  submitLabel,
  footer,
}: {
  action: Action<[FormData], unknown>;
  children: React.ReactNode;
  className?: string;
  submitLabel?: string;
  footer?: React.ReactNode;
}) {
  const { run, pending, error } = useServerAction(action);
  return (
    <form
      className={cn("grid gap-5", className)}
      onSubmit={(e) => {
        e.preventDefault();
        run(new FormData(e.currentTarget));
      }}
    >
      {children}
      <FormError error={error} />
      {(submitLabel || footer) && (
        <div className="flex items-center gap-2">
          {submitLabel && (
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          )}
          {footer}
        </div>
      )}
    </form>
  );
}

/** Button that opens a dialog with a form; the form posts to a server action and the dialog closes on success. */
export function FormDialog({
  trigger,
  title,
  description,
  action,
  submitLabel,
  children,
  wide,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action: Action<[FormData], unknown>;
  submitLabel: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending, error, setError } = useServerAction(action, { onSuccess: () => setOpen(false) });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={cn(wide && "sm:max-w-xl")}>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            run(new FormData(e.currentTarget));
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
          <FormError error={error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Runs a server action with fixed arguments, e.g. "Send test event". */
export function ActionButton<A extends unknown[]>({
  action,
  args,
  children,
  ...props
}: {
  action: Action<A, unknown>;
  args: A;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Button>, "onClick" | "children">) {
  const { run, pending } = useServerAction(action, { toastErrors: true });
  return (
    <Button type="button" {...props} disabled={pending || props.disabled} onClick={() => run(...args)}>
      {children}
    </Button>
  );
}

/** Asks for confirmation before running a destructive server action. */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  action,
  args,
  confirmText,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  // Loosely typed: with confirmText the typed text is appended to args.
  action: Action<any[], unknown>;
  args: unknown[];
  /** When set, the user must type this exact text to enable the button; it's passed as the last argument. */
  confirmText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const { run, pending, error } = useServerAction(action, { onSuccess: () => setOpen(false) });
  const blocked = confirmText !== undefined && typed.trim().toLowerCase() !== confirmText.toLowerCase();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirmText !== undefined && (
          <label className="grid gap-1.5 text-sm font-medium">
            Type {confirmText} to confirm
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
        )}
        <FormError error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || blocked}
            variant="destructive"
            onClick={(e) => {
              e.preventDefault(); // keep it open until the action finishes
              run(...(confirmText !== undefined ? [...args, typed] : args));
            }}
          >
            {pending ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A switch that saves immediately through a server action called with (id, checked). */
export function ActionSwitch({
  action,
  id,
  checked,
  label,
}: {
  action: Action<[string, boolean], unknown>;
  id: string;
  checked: boolean;
  label: string;
}) {
  const { run, pending } = useServerAction(action, { toastErrors: true });
  return <Switch checked={checked} disabled={pending} aria-label={label} onCheckedChange={(v) => run(id, v)} />;
}
