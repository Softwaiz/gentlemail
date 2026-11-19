"use client";

import { Check, Copy, Download, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import {
  confirmMfaSetupAction,
  disableMfaAction,
  regenerateRecoveryCodesAction,
  startMfaSetupAction,
} from "@/app/actions/security";
import { FormDialog, FormError, useServerAction } from "@/app/components/action-form";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";

type Setup = { secret: string; qr: string; uri: string };

const CodeInput = ({ id, recovery }: { id: string; recovery?: boolean }) => (
  <div className="grid gap-1.5">
    <Label htmlFor={id}>{recovery ? "Code from your app, or a recovery code" : "Code from your app"}</Label>
    <Input
      id={id}
      name="code"
      required
      autoComplete="one-time-code"
      inputMode={recovery ? "text" : "numeric"}
      maxLength={20}
      placeholder="123456"
      className="h-10 max-w-56 font-mono tracking-[0.2em]"
    />
  </div>
);

/**
 * Two-step verification for the signed-in person: set up (QR → first code →
 * recovery codes), new recovery codes, turn off. One component for every
 * state, so freshly made codes stay on screen while the page refreshes.
 */
export function MfaPanel({
  enabled,
  enabledAt,
  codesLeft,
  required,
  email,
  host,
  next,
}: {
  enabled: boolean;
  enabledAt: string | null;
  codesLeft: number;
  required: boolean;
  email: string;
  host: string;
  /** A page to go back to once the recovery codes are saved (two-step was required to open it). */
  next?: string;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  const start = useServerAction(startMfaSetupAction, { onSuccess: (r) => r.data && setSetup(r.data) });
  const confirm = useServerAction(confirmMfaSetupAction, {
    onSuccess: (r) => {
      if (r.data) setCodes(r.data.codes);
      setSetup(null);
    },
  });

  if (codes) return <RecoveryCodes codes={codes} email={email} host={host} onDone={() => (next ? window.location.assign(next) : setCodes(null))} />;

  if (enabled) {
    return (
      <div className="grid gap-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lime/25 text-foreground dark:bg-lime/15 dark:text-lime">
            <ShieldCheck className="size-5" />
          </span>
          <div className="text-sm">
            <div className="font-medium">On{enabledAt ? ` since ${enabledAt}` : ""}</div>
            <div className="text-muted-foreground">
              Signing in asks for a code from your authenticator app. {codesLeft} of 10 recovery codes left
              {codesLeft <= 3 ? ": make new ones soon." : "."}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <FormDialog
            trigger={
              <Button variant="outline">
                <KeyRound /> New recovery codes
              </Button>
            }
            title="New recovery codes"
            description="Your current recovery codes stop working, and you get 10 new ones."
            action={async (form: FormData) => {
              const r = await regenerateRecoveryCodesAction(form);
              if (r?.ok && r.data) setCodes(r.data.codes);
              return r;
            }}
            submitLabel="Make new codes"
          >
            <CodeInput id="regen-code" />
          </FormDialog>
          <FormDialog
            trigger={<Button variant="ghost" className="text-destructive hover:text-destructive">Turn off</Button>}
            title="Turn off two-step verification?"
            description={
              required
                ? "Your admin requires two-step verification, so you'll be asked to set it up again straight away. Use this to move it to a new phone."
                : "Signing in will only need your password."
            }
            action={disableMfaAction}
            submitLabel="Turn off"
          >
            <CodeInput id="off-code" recovery />
          </FormDialog>
        </div>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="grid gap-4">
        <p className="max-w-prose text-sm text-muted-foreground">
          After your password, signing in also asks for a 6-digit code from an authenticator app on your phone, such as
          Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden or Authy. Someone who learns your password still
          can't get in.
        </p>
        <div>
          <Button onClick={() => start.run()} disabled={start.pending}>
            <ShieldCheck /> {start.pending ? "Preparing…" : "Set up two-step verification"}
          </Button>
        </div>
        <FormError error={start.error} />
      </div>
    );
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        confirm.run(new FormData(e.currentTarget));
      }}
    >
      <ol className="grid gap-5 text-sm">
        <li className="grid gap-3">
          <span className="font-medium">1. Scan this QR code with your authenticator app</span>
          <div className="flex flex-wrap items-start gap-5">
            <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-md border bg-white p-1" />
            <div className="grid max-w-xs gap-1.5 text-muted-foreground">
              <span>Can't scan it? Choose “Enter a setup key” in the app and type:</span>
              <code className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-[13px] break-all text-foreground select-all">{setup.secret}</code>
              <span className="text-xs">Time-based, 6 digits. On a phone, you can also <a href={setup.uri} className="underline underline-offset-4">open it in your app</a>.</span>
            </div>
          </div>
        </li>
        <li className="grid gap-3">
          <span className="font-medium">2. Enter the 6-digit code the app shows</span>
          <CodeInput id="setup-code" />
        </li>
      </ol>
      <FormError error={confirm.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={confirm.pending}>
          {confirm.pending ? "Checking…" : "Turn on"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Shown once, right after they're made: download or copy, then confirm they're saved. */
function RecoveryCodes({ codes, email, host, onDone }: { codes: string[]; email: string; host: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileText = [
    `Recovery codes for ${email} on ${host}`,
    `Made ${new Date().toISOString().slice(0, 10)}. Each code works once, in place of the code from your authenticator app.`,
    "",
    ...codes,
    "",
  ].join("\n");

  const download = () => {
    const url = URL.createObjectURL(new Blob([fileText], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `recovery-codes-${host}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  return (
    <div className="grid gap-5">
      <div>
        <div className="text-sm font-medium">Save your recovery codes</div>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          If you lose your phone, each of these codes lets you sign in once. Keep them somewhere safe, like your password
          manager. This is the only time they're shown.
        </p>
      </div>
      <ul className="grid max-w-md grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border bg-muted/40 px-4 py-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={download}>
          <Download /> Download .txt
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            navigator.clipboard.writeText(codes.join("\n")).then(() => {
              setCopied(true);
              setSaved(true);
            })
          }
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" variant="ghost" disabled={!saved} onClick={onDone} title={saved ? undefined : "Download or copy them first"}>
          I've saved them
        </Button>
      </div>
    </div>
  );
}
