import { Lock, SearchX } from "lucide-react";
import type { RequestInfo } from "rwsdk/worker";
import { Shell } from "@/app/components/shell";
import { Button } from "@/app/components/ui/button";
import { AuthCard } from "@/app/pages/auth";
import type { User } from "@/lib/auth";
import type { MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { i18n } from "@/lib/i18n";

/*
 * "Not found" and "Access restricted" pages. They render inside the app (with
 * the sidebar) for signed-in people, so switching mailbox is one click away.
 */

export type ErrorKind = "page" | "mailbox" | "message" | "domain" | "webhook" | "mailbox-restricted" | "admin-restricted";

const ERRORS: Record<ErrorKind, { status: 404 | 403; title: MessageDescriptor; body: MessageDescriptor }> = {
  page: {
    status: 404,
    title: msg({ id: "errors.page_title", message: "Page not found" }),
    body: msg({ id: "errors.page_body", message: "There's nothing at this address. The link may be mistyped or out of date." }),
  },
  mailbox: {
    status: 404,
    title: msg({ id: "errors.mailbox_title", message: "Mailbox not found" }),
    body: msg({ id: "errors.mailbox_body", message: "This mailbox doesn't exist. It may have been deleted, or the link is wrong." }),
  },
  message: {
    status: 404,
    title: msg({ id: "errors.message_title", message: "Message not found" }),
    body: msg({ id: "errors.message_body", message: "This conversation isn't in this mailbox. It may have been deleted for good, or the link is wrong." }),
  },
  domain: {
    status: 404,
    title: msg({ id: "errors.domain_title", message: "Domain not found" }),
    body: msg({ id: "errors.domain_body", message: "This domain doesn't exist. It may have been removed, or the link is wrong." }),
  },
  webhook: {
    status: 404,
    title: msg({ id: "errors.webhook_title", message: "Webhook not found" }),
    body: msg({ id: "errors.webhook_body", message: "This webhook doesn't exist. It may have been deleted, or the link is wrong." }),
  },
  "mailbox-restricted": {
    status: 403,
    title: msg({ id: "errors.restricted_title", message: "Access restricted" }),
    body: msg({ id: "errors.mailbox_restricted_body", message: "You don't have permission to view this mailbox. Ask an admin to give you access." }),
  },
  "admin-restricted": {
    status: 403,
    title: msg({ id: "errors.restricted_title", message: "Access restricted" }),
    body: msg({ id: "errors.admin_restricted_body", message: "Only admins can open this page." }),
  },
};

export function ErrorPage({ kind, user, mailboxId }: { kind: ErrorKind; user: User | null; mailboxId?: string }) {
  const d = ERRORS[kind];
  const e = { status: d.status, title: i18n._(d.title), body: i18n._(d.body) };
  const restricted = e.status === 403;
  const Icon = restricted ? Lock : SearchX;

  if (!user) {
    return (
      <AuthCard title={e.title}>
        <p className="text-sm text-muted-foreground">{e.body}</p>
        <Button asChild variant="outline" className="mt-5 w-full">
          <a href="/login">{t({ id: "errors.sign_in", message: "Sign in" })}</a>
        </Button>
      </AuthCard>
    );
  }

  return (
    <Shell user={user} mailboxId={mailboxId}>
      <section aria-labelledby="error-title" className="grid flex-1 place-items-center py-16">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
            <Icon className="size-6" />
          </div>
          <p className="text-[13px] font-semibold tracking-[0.08em] text-muted-foreground uppercase tabular-nums">
            {t({ id: "errors.code", message: `Error ${e.status}` })}
          </p>
          <h1 id="error-title" className="mt-2 text-[28px] leading-tight font-semibold tracking-[-0.025em] text-balance">
            {e.title}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-pretty text-muted-foreground">{e.body}</p>
          {restricted && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              <Trans id="errors.signed_in_as">
                You're signed in as <span className="font-medium text-foreground">{user.email}</span>.
              </Trans>
            </p>
          )}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            <Button asChild>
              <a href="/">{t({ id: "oauth.back", message: "Back to your mail" })}</a>
            </Button>
            {restricted && (
              <form method="post" action="/logout">
                <Button variant="outline">{t({ id: "errors.switch_user", message: "Sign in as someone else" })}</Button>
              </form>
            )}
          </div>
        </div>
      </section>
    </Shell>
  );
}

/** Route middleware: answer with the error page and its real HTTP status. */
export function showError(ri: RequestInfo, kind: ErrorKind, mailboxId?: string) {
  ri.response.status = ERRORS[kind].status;
  return <ErrorPage kind={kind} user={ri.ctx.user ?? null} mailboxId={mailboxId} />;
}

/**
 * For a page whose record is missing while it renders. After a server action
 * (e.g. "Delete mailbox") rwsdk re-renders the current page; the record is gone
 * on purpose and the client is about to follow the action's redirect, so show
 * an empty frame instead of an error. Otherwise it's a genuine "not found".
 */
export function missing(ri: RequestInfo, kind: ErrorKind) {
  if (ri.isAction) return <Shell user={ri.ctx.user!}>{null}</Shell>;
  return <ErrorPage kind={kind} user={ri.ctx.user ?? null} />;
}
