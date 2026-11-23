import { ShakeCard } from "@/app/components/auth-motion";
import { LogoMark, Wordmark, appName, hasLogo } from "@/app/components/brand";
import { PasswordInput } from "@/app/components/password-input";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

/*
 * What the sign-in screens draw, from what they're given. No database, no request:
 * the pages in auth.tsx load what's needed and pass it here, and stories pass made-up values.
 */

/** The id of the card's error, for the fields it is about (aria-describedby). */
const AUTH_ERROR = "auth-error";

/**
 * Full-bleed ink screen in the Softwaiz manner: grid texture, oversized
 * display wordmark, and a paper card holding the form.
 */
export function AuthCard({ title, children, err }: { title: string; children: React.ReactNode; err?: string | null }) {
  return (
    <div className="bg-grid relative min-h-screen overflow-hidden bg-sidebar text-sidebar-foreground">
      <div className="mx-auto grid min-h-screen max-w-[1180px] items-center gap-10 px-5 py-10 md:grid-cols-[minmax(0,1fr)_400px] md:px-10">
        <div className="min-w-0">
          <div className="mb-8 flex items-center gap-3 text-[15px]">
            <LogoMark className="size-9 ring-1 ring-sidebar-border rounded-[10px]" />
            <span className="text-sidebar-muted">{t({ id: "auth.tagline", message: "Mail for every domain you run" })}</span>
          </div>
          {hasLogo() ? (
            <Wordmark className="h-[clamp(44px,7vw,92px)] max-w-full" />
          ) : (
            <div aria-hidden="true" className="text-[clamp(48px,8vw,104px)] leading-[0.95] font-bold tracking-[-0.045em] break-words">
              {appName()}
              <span className="text-lime">.</span>
            </div>
          )}
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-sidebar-muted">
            {t({
              id: "auth.pitch",
              message: "Receive, read and answer mail for all your domains in one place. Your messages stay on your own Cloudflare account.",
            })}
          </p>
        </div>

        <ShakeCard
          error={err}
          className="rounded-lg border border-sidebar-border bg-background p-7 text-foreground shadow-[0_30px_80px_-20px_rgb(0_0_0/60%)]"
        >
          <h1 className="text-xl font-semibold tracking-[-0.02em]">{title}</h1>
          {err && (
            <div
              id={AUTH_ERROR}
              role="alert"
              className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
            >
              {err}
            </div>
          )}
          <div className="mt-5">{children}</div>
        </ShakeCard>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -bottom-40 size-[420px] rounded-full bg-lime/10 blur-3xl" />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

export type LoginViewProps = {
  /** Where to go once signed in. */
  next: string;
  /** The email from the last attempt, kept after a wrong password. */
  email?: string;
  /** The error from the last attempt, such as "Wrong email or password." */
  err?: string | null;
  /** The error is about the email and password: marks both fields. */
  wrong?: boolean;
};

/**
 * The sign-in form. After a wrong password it is sent back in answer to the POST (not by a
 * redirect), so the email stays filled in without going into the URL, and the cursor waits
 * in the emptied password field.
 */
export function LoginView({ next, email, err, wrong }: LoginViewProps) {
  return (
    <AuthCard title={t({ id: "signin.title", message: "Sign in" })} err={err}>
      <form method="post" className="grid gap-4">
        <input type="hidden" name="next" value={next} />
        <Field label={t({ id: "signin.email", message: "Email" })}>
          <Input
            name="email"
            type="email"
            required
            autoComplete="username"
            defaultValue={email}
            autoFocus={!email}
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? AUTH_ERROR : undefined}
            className="h-10"
          />
        </Field>
        <Field label={t({ id: "signin.password", message: "Password" })}>
          <PasswordInput
            name="password"
            required
            autoComplete="current-password"
            autoFocus={!!email}
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? AUTH_ERROR : undefined}
            className="h-10"
          />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full">
          {t({ id: "signin.submit", message: "Sign in" })}
        </Button>
      </form>
    </AuthCard>
  );
}

export type VerifyViewProps = {
  /** The account signing in. */
  email: string;
  /** The error from the last code, such as "That code didn't work. 4 tries left." */
  err?: string;
};

export function VerifyView({ email, err }: VerifyViewProps) {
  return (
    <AuthCard title={t({ id: "verify.title", message: "Two-step verification" })} err={err}>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        <Trans id="verify.intro">
          Enter the 6-digit code from your authenticator app for <span className="font-medium text-foreground">{email}</span>.
        </Trans>
      </p>
      <form method="post" className="grid gap-4">
        <Field label={t({ id: "verify.code", message: "Code" })}>
          <Input
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={20}
            placeholder="123456"
            aria-invalid={err ? true : undefined}
            aria-describedby={err ? AUTH_ERROR : undefined}
            className="h-11 font-mono text-lg tracking-[0.3em]"
          />
        </Field>
        <Button type="submit" size="lg" className="w-full">
          {t({ id: "verify.submit", message: "Verify" })}
        </Button>
      </form>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        <Trans id="verify.recovery_hint">
          No access to your app? Type one of your recovery codes (like <span className="font-mono">abcde-23456</span>) in the same box. Each one works once.
        </Trans>
      </p>
      <a href="/login" className="mt-3 inline-block text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">
        {t({ id: "verify.other_account", message: "Use another account" })}
      </a>
    </AuthCard>
  );
}

export type SetupViewProps = {
  /** Whether SETUP_TOKEN is set. Without it, the screen says how to set one. */
  hasToken: boolean;
  err?: string;
  /** The field the error is about. */
  bad?: "token" | "password";
  /** The name from the last attempt. */
  name?: string;
  /** The email from the last attempt. */
  email?: string;
};

export function SetupView({ hasToken, err, bad, name, email }: SetupViewProps) {
  if (!hasToken) {
    return (
      <AuthCard title={t({ id: "setup.title_no_token", message: "Setup" })}>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t({ id: "setup.no_token", message: "Set a one-time setup token first, then reload this page:" })}
        </p>
        <pre className="mt-3 rounded-md bg-muted px-3 py-2 font-mono text-xs">npx wrangler secret put SETUP_TOKEN</pre>
        <p className="mt-3 text-xs text-muted-foreground">
          <Trans id="setup.no_token_local">
            Locally, put <code className="font-mono">SETUP_TOKEN=…</code> in <code className="font-mono">.dev.vars</code>.
          </Trans>
        </p>
      </AuthCard>
    );
  }
  const invalid = (f: "token" | "password") => (bad === f ? { "aria-invalid": true, "aria-describedby": AUTH_ERROR, autoFocus: true } : {});
  return (
    <AuthCard title={t({ id: "setup.title", message: "Create the admin account" })} err={err}>
      <form method="post" className="grid gap-4">
        <Field label={t({ id: "setup.token", message: "Setup token" })}>
          <PasswordInput name="token" kind="token" required className="h-10" {...invalid("token")} />
        </Field>
        <Field label={t({ id: "setup.name", message: "Your name" })}>
          <Input name="name" required defaultValue={name} className="h-10" />
        </Field>
        <Field label={t({ id: "setup.email", message: "Login email" })}>
          <Input name="email" type="email" required defaultValue={email} className="h-10" />
        </Field>
        <Field label={t({ id: "setup.password", message: "Password (10 characters or more)" })}>
          <PasswordInput name="password" minLength={10} required autoComplete="new-password" className="h-10" {...invalid("password")} />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full">
          {t({ id: "setup.submit", message: "Create admin account" })}
        </Button>
      </form>
    </AuthCard>
  );
}
