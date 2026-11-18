import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { targetNames } from "@/app/components/access-summary";
import { Connections } from "@/app/components/connections";
import { MfaPanel } from "@/app/components/mfa-panel";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Section } from "@/app/components/section";
import { listActiveGrants, listConnections } from "@/lib/apikeys";
import { isMfaRequired, recoveryCodesLeft } from "@/lib/mfa";
import { publicUrl } from "@/lib/webhooks";

/* ---------- /account/security: the signed-in person's own two-step verification ---------- */

export async function SecurityPage({ ctx, request }: RequestInfo) {
  const user = ctx.user!;
  const [row, codesLeft, required, connections, grants, domains, mailboxes] = await Promise.all([
    env.DB.prepare("SELECT mfa_enabled_at FROM users WHERE id = ?").bind(user.id).first<{ mfa_enabled_at: number | null }>(),
    recoveryCodesLeft(user.id),
    isMfaRequired(),
    listConnections(user.id),
    listActiveGrants("connections"),
    env.DB.prepare("SELECT id, name FROM domains").all<{ id: string; name: string }>(),
    env.DB.prepare("SELECT id, address FROM mailboxes").all<{ id: string; address: string }>(),
  ]);
  const mine = new Set(connections.map((c) => c.id));

  return (
    <Shell user={user} folder="security" flash={flashFrom(request)}>
      <PageHeader title="Security" sub={user.email} />
      <div className="grid max-w-3xl gap-6">
        {user.mustSetUpMfa && (
          <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <span className="font-medium">Your admin requires two-step verification.</span> Set it up below to open your mail.
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
          />
        </Section>
        {!user.mustSetUpMfa && (
          <Connections
            connections={connections}
            grants={grants.filter((g) => mine.has(g.key_id))}
            names={targetNames({ domains: domains.results, mailboxes: mailboxes.results })}
            mcpUrl={`${publicUrl() || new URL(request.url).origin}/mcp`}
          />
        )}
      </div>
    </Shell>
  );
}
