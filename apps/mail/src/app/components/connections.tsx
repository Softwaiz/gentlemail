import { disconnectAssistantAction } from "@/app/actions/connections";
import { ConfirmAction } from "@/app/components/action-form";
import { AccessSummary } from "@/app/components/access-summary";
import { Code } from "@/app/components/code-samples";
import { Section, cardRow, cardTable, cardTableHeader } from "@/app/components/section";
import { Button } from "@/app/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/components/ui/table";
import type { Connection, Grant } from "@/lib/apikeys";
import { formatDate } from "@/lib/util";
import { cn } from "@/lib/utils";

/**
 * AI assistants connected by signing in (MCP + OAuth), with a Disconnect
 * button each: on the Security page your own, on API & webhooks everyone's.
 */
export function Connections({
  connections,
  grants,
  names,
  mcpUrl,
  showOwner = false,
}: {
  connections: Connection[];
  grants: (Grant & { key_id: string })[];
  names: Map<string, string>;
  mcpUrl: string;
  showOwner?: boolean;
}) {
  const byKey = new Map<string, Grant[]>();
  for (const g of grants) {
    const list = byKey.get(g.key_id);
    if (list) list.push(g);
    else byKey.set(g.key_id, [g]);
  }
  return (
    <Section
      title="Connected assistants"
      description={
        <>
          AI assistants such as Claude or ChatGPT, connected by signing in. Each reaches only the mailboxes chosen when it
          connected. To connect one, add this server address to it as an MCP server or custom connector:
        </>
      }
    >
      <div className="grid gap-4">
        <Code>{mcpUrl}</Code>
        <Table className={cardTable}>
          <TableHeader className={cardTableHeader}>
            <TableRow>
              <TableHead>Assistant</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map((c) => (
              <TableRow key={c.id} className={cn(cardRow, "max-lg:grid-cols-[1fr_auto]")}>
                <TableCell className="min-w-32 whitespace-normal max-lg:min-w-0">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {showOwner ? `${c.user_email} · ` : ""}connected {formatDate(c.created_at)}
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal max-lg:col-span-2 max-lg:row-start-2">
                  <AccessSummary grants={byKey.get(c.id) ?? []} names={names} />
                </TableCell>
                <TableCell className="text-muted-foreground lg:min-w-28 lg:whitespace-normal max-lg:col-span-2 max-lg:row-start-3 max-lg:text-xs">
                  {c.last_used_at ? (
                    <>
                      <span className="lg:hidden">Last used </span>
                      {formatDate(c.last_used_at, true)}
                    </>
                  ) : (
                    <>
                      Never<span className="lg:hidden"> used</span>
                    </>
                  )}
                </TableCell>
                <TableCell className="text-right max-lg:col-start-2 max-lg:row-start-1 max-lg:self-start">
                  <ConfirmAction
                    trigger={
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                        Disconnect
                      </Button>
                    }
                    title={`Disconnect “${c.name}”?`}
                    description="It is refused from its next request. To use it again, connect it again and sign in."
                    confirmLabel="Disconnect"
                    action={disconnectAssistantAction}
                    args={[c.id]}
                  />
                </TableCell>
              </TableRow>
            ))}
            {connections.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center whitespace-normal text-muted-foreground max-lg:block">
                  No assistant connected yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
