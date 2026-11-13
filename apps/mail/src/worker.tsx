import { WorkerEntrypoint } from "cloudflare:workers";
import { render, route } from "rwsdk/router";
import { defineApp, type RequestInfo } from "rwsdk/worker";

import { Document } from "@/app/document";
import { setCommonHeaders } from "@/app/headers";
import { checkOrigin, redirect, requireAdmin, requireUser } from "@/app/http";
import {
  AdminMailboxPage,
  AdminPage,
  AdminUserPage,
  adminMailboxAction,
  adminUserAction,
  createMailboxAction,
  createUserAction,
} from "@/app/pages/admin";
import { AdminDomainPage, adminDomainAction, createDomainAction } from "@/app/pages/domains";
import { Button } from "@/app/components/ui/button";
import { AuthCard, LoginPage, SetupPage, loginAction, logoutAction, setupAction } from "@/app/pages/auth";
import { ComposePage, SettingsPage, composeAction, settingsAction } from "@/app/pages/compose";
import { attachmentHandler, bodyHandler, rawHandler } from "@/app/pages/files";
import { FolderPage, ThreadPage, actionsHandler } from "@/app/pages/mailbox";
import { type User, getUserFromRequest } from "@/lib/auth";
import { listMailboxesForUser } from "@/lib/db";
import { handleInbound } from "@/lib/inbound";
import { retryDueDeliveries } from "@/lib/webhooks";
import {
  apiNotFound,
  attachmentApiHandler,
  listHandler,
  mailboxesHandler,
  messageActionHandler,
  messageHandler,
  sendHandler,
} from "@/app/api";
import { DevelopersPage, WebhookPage, developersAction, webhookAction } from "@/app/pages/developers";

export type AppContext = { user: User | null };

async function home({ ctx }: RequestInfo) {
  const boxes = await listMailboxesForUser(ctx.user!);
  if (boxes.length) return redirect(`/mb/${boxes[0].id}/inbox`);
  return redirect(ctx.user!.role === "admin" ? "/admin" : "/no-mailbox");
}

const app = defineApp([
  setCommonHeaders(),
  checkOrigin,
  async ({ ctx, request }) => {
    ctx.user = await getUserFromRequest(request);
  },

  // Raw (non-HTML-document) endpoints
  route("/logout", { post: logoutAction }),
  route("/attachments/:id", [requireUser, attachmentHandler]),
  route("/raw/:id", [requireUser, rawHandler]),
  route("/body/:id", [requireUser, bodyHandler]),
  route("/mb/:mailboxId/actions", { post: [requireUser, actionsHandler] }),
  // Public API (API keys, no cookies). See src/app/api.ts.
  route("/api/v1/send", { post: sendHandler }),
  route("/api/v1/mailboxes", { get: mailboxesHandler }),
  route("/api/v1/messages", { get: listHandler }),
  route("/api/v1/messages/:id", { get: messageHandler, post: messageActionHandler }),
  route("/api/v1/attachments/:id", { get: attachmentApiHandler }),
  route("/api/*", apiNotFound),

  route("/admin/domains", { post: [requireAdmin, createDomainAction] }),
  route("/admin/mailboxes", { post: [requireAdmin, createMailboxAction] }),
  route("/admin/users", { post: [requireAdmin, createUserAction] }),

  render(Document, [
    route("/setup", { get: SetupPage, post: setupAction }),
    route("/login", { get: LoginPage, post: loginAction }),
    route("/", [requireUser, home]),
    route("/no-mailbox", [
      requireUser,
      () => (
        <AuthCard title="No mailbox yet">
          <p className="text-sm text-muted-foreground">Ask an admin to give you access to a mailbox, then sign in again.</p>
          <form method="post" action="/logout" className="mt-5">
            <Button variant="outline" className="w-full">
              Log out
            </Button>
          </form>
        </AuthCard>
      ),
    ]),

    route("/admin", [requireAdmin, AdminPage]),
    route("/admin/api", { get: [requireAdmin, (i) => DevelopersPage(i)], post: [requireAdmin, developersAction] }),
    route("/admin/webhooks/:id", { get: [requireAdmin, WebhookPage], post: [requireAdmin, webhookAction] }),
    route("/admin/domains/:id", { get: [requireAdmin, AdminDomainPage], post: [requireAdmin, adminDomainAction] }),
    route("/admin/mailboxes/:id", { get: [requireAdmin, AdminMailboxPage], post: [requireAdmin, adminMailboxAction] }),
    route("/admin/users/:id", { get: [requireAdmin, AdminUserPage], post: [requireAdmin, adminUserAction] }),

    route("/mb/:mailboxId/compose", { get: [requireUser, ComposePage], post: [requireUser, composeAction] }),
    route("/mb/:mailboxId/settings", { get: [requireUser, SettingsPage], post: [requireUser, settingsAction] }),
    route("/mb/:mailboxId/thread/:threadId", [requireUser, ThreadPage]),
    route("/mb/:mailboxId/:folder", [requireUser, FolderPage]),
  ]),
]);

/**
 * Worker entrypoint: HTTP goes to the rwsdk app, inbound mail (Email Routing
 * catch-all → this Worker) is parsed and stored in D1 + R2.
 */
export default class MailWorker extends WorkerEntrypoint<Env> {
  async email(message: ForwardableEmailMessage) {
    try {
      await handleInbound(message);
    } catch (err) {
      console.error("inbound mail failed", err);
      // Temporary failure → sending server will retry later.
      message.setReject("451 4.3.0 Temporary failure, please retry");
    }
  }

  /** Cron (every minute): retry webhook deliveries that are due. */
  async scheduled() {
    await retryDueDeliveries();
  }

  override async fetch(request: Request) {
    return app.fetch(request, this.env, this.ctx);
  }
}
