import { LogoMark, Wordmark, appName, hasLogo } from "@/app/components/brand";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

/*
 * What the sign-in screens draw, from what they're given. No database, no request:
 * the pages in auth.tsx load what's needed and pass it here, and stories pass made-up values.
 */

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
            <span className="text-sidebar-muted">Mail for every domain you run</span>
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
            Receive, read and answer mail for all your domains in one place. Your messages stay on your own Cloudflare
            account.
          </p>
        </div>

        <div className="rounded-lg border border-sidebar-border bg-background p-7 text-foreground shadow-[0_30px_80px_-20px_rgb(0_0_0/60%)]">
          <h1 className="text-xl font-semibold tracking-[-0.02em]">{title}</h1>
          {err && (
            <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {err}
            </div>
          )}
          <div className="mt-5">{children}</div>
        </div>
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
  /** The error from the last attempt, such as "Wrong email or password." */
  err?: string | null;
};

export function LoginView({ next, err }: LoginViewProps) {
  return (
    <AuthCard title="Sign in" err={err}>
      <form method="post" className="grid gap-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Email">
          <Input name="email" type="email" required autoComplete="username" autoFocus className="h-10" />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" required autoComplete="current-password" className="h-10" />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

export type VerifyViewProps = {
  /** The account signing in. */
  email: string;
  /** The error from the last code, such as "That code didn't work. 4 tries left." */
  err?: string | null;
};

export function VerifyView({ email, err }: VerifyViewProps) {
  return (
    <AuthCard title="Two-step verification" err={err}>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        Enter the 6-digit code from your authenticator app for <span className="font-medium text-foreground">{email}</span>.
      </p>
      <form method="post" className="grid gap-4">
        <Field label="Code">
          <Input
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={20}
            placeholder="123456"
            className="h-11 font-mono text-lg tracking-[0.3em]"
          />
        </Field>
        <Button type="submit" size="lg" className="w-full">
          Verify
        </Button>
      </form>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        No access to your app? Type one of your recovery codes (like <span className="font-mono">abcde-23456</span>) in the same box. Each one works once.
      </p>
      <a href="/login" className="mt-3 inline-block text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">
        Use another account
      </a>
    </AuthCard>
  );
}

export type SetupViewProps = {
  /** Whether SETUP_TOKEN is set. Without it, the screen says how to set one. */
  hasToken: boolean;
  err?: string | null;
};

export function SetupView({ hasToken, err }: SetupViewProps) {
  if (!hasToken) {
    return (
      <AuthCard title="Setup">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Set a one-time setup token first, then reload this page:
        </p>
        <pre className="mt-3 rounded-md bg-muted px-3 py-2 font-mono text-xs">npx wrangler secret put SETUP_TOKEN</pre>
        <p className="mt-3 text-xs text-muted-foreground">
          Locally, put <code className="font-mono">SETUP_TOKEN=…</code> in <code className="font-mono">.dev.vars</code>.
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Create the admin account" err={err}>
      <form method="post" className="grid gap-4">
        <Field label="Setup token">
          <Input name="token" type="password" required className="h-10" />
        </Field>
        <Field label="Your name">
          <Input name="name" required className="h-10" />
        </Field>
        <Field label="Login email">
          <Input name="email" type="email" required className="h-10" />
        </Field>
        <Field label="Password (10 characters or more)">
          <Input name="password" type="password" minLength={10} required autoComplete="new-password" className="h-10" />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full">
          Create admin account
        </Button>
      </form>
    </AuthCard>
  );
}
