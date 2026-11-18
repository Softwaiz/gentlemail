import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { targetNames } from "@/app/components/access-summary";
import { Connections } from "@/app/components/connections";
import { MfaPanel } from "@/app/components/mfa-panel";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Section } from "@/app/components/section";
import { safeNext } from "@/app/http";
import { type Grant, listActiveGrants, listConnections } from "@/lib/apikeys";
import { isMfaRequired, recoveryCodesLeft } from "@/lib/mfa";
import { publicUrl } from "@/lib/webhooks";

/* ---------- /account/security: the signed-in person's own two-step verification ---------- */

/** Names of the domains and mailboxes these grants are on, and nothing else. */
async function namesFor(grants: Grant[]) {
  const ids = (type: string) => JSON.stringify([...new Set(grants.filter((g) => g.target_type === type).map((g) => g.target_id))]);
  const [domains, mailboxes] = await Promise.all([
    env.DB.prepare("SELECT id, name FROM domains WHERE id IN (SELECT value FROM json_each(?))").bind(ids("domain")).all<{ id: string; name: string }>(),
    env.DB.prepare("SELECT id, address FROM mailboxes WHERE id IN (SELECT value FROM json_each(?))")
      .bind(ids("mailbox"))
      .all<{ id: string; address: string }>(),
  ]);
  return targetNames({ domains: domains.results, mailboxes: mailboxes.results });
}

export async function SecurityPage({ ctx, request }: RequestInfo) {
  const user = ctx.user!;
  const [row, codesLeft, required, connections, grants] = await Promise.all([
    env.DB.prepare("SELECT mfa_enabled_at FROM users WHERE id = ?").bind(user.id).first<{ mfa_enabled_at: number | null }>(),
    recoveryCodesLeft(user.id),
    isMfaRequired(),
    listConnections(user.id),
    listActiveGrants("connections", user.id),
  ]);
  const names = await namesFor(grants);
  // Sent here to set up required two-step verification from another page: go back there afterwards.
  const next = new URL(request.url).searchParams.get("next");
  const back = next ? safeNext(next) : null;

  return (
    <Shell user={user} folder="security" flash={flashFrom(request)}>
      <PageHeader title="Security" sub={user.email} />
      <div className="grid max-w-3xl gap-6">
        {user.mustSetUpMfa && (
          <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <span className="font-medium">Your admin requires two-step verification.</span>{" "}
            {back ? "Set it up below; then you go back to where you were." : "Set it up below to open your mail."}
          </div>
        )}
        {!user.mustSetUpMfa && row?.mfa_enabled_at && back && back !== "/" && (
          <div role="status" className="rounded-md border px-4 py-3 text-sm">
            Two-step verification is on.{" "}
            <a href={back} className="font-medium underline underline-offset-4">
              Continue where you were
            </a>
          </div>
        )}
        <Section
          title="Two-step verification"
          description={required ? "Required for everyone on this server." : "Recommended. Your admin may also require it."}
        >
          <MfaPanel
            enabled={!!row?.mfa_enabled_at}
            enabledAt={row?.mfa_enabled_at ? new Date(row.mfa_enabled_at).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" }) : null}
            codesLeft={codesLeft}
            required={required}
            email={user.email}
            host={new URL(request.url).hostname}
            next={back && back !== "/" ? back : undefined}
          />
        </Section>
        {!user.mustSetUpMfa && (
          <Connections
            connections={connections}
            grants={grants}
            names={names}
            mcpUrl={`${publicUrl() || new URL(request.url).origin}/mcp`}
          />
        )}
      </div>
    </Shell>
  );
}
