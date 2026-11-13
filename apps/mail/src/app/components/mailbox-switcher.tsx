"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "rwsdk/client";
import { getSwitcherGroups } from "@/app/actions/queries";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/app/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import type { SwitcherGroup } from "@/lib/db";
import { cn } from "@/lib/utils";

/** Current mailbox at the top of the sidebar; opens a list of every mailbox, grouped by domain. */
export function MailboxSwitcher({
  current,
  groups: initial,
  folder,
}: {
  current: { id: string; address: string; name: string } | null;
  groups: SwitcherGroup[];
  folder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState(initial);
  useEffect(() => setGroups(initial), [initial]);
  const total = groups.reduce((n, g) => n + g.mailboxes.length, 0);

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    // Refresh unread counts without re-rendering the page (serverQuery).
    if (o) getSwitcherGroups().then((g) => Array.isArray(g) && setGroups(g)).catch(() => {});
  };

  const go = (id: string) => {
    setOpen(false);
    const keep = folder && ["inbox", "sent", "archive", "spam", "trash", "settings"].includes(folder) ? folder : "inbox";
    navigate(`/mb/${id}/${keep}`);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className="flex w-full items-center gap-3 rounded-md border border-sidebar-border px-3 py-2.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-violet data-[state=open]:bg-sidebar-accent"
        aria-label="Switch mailbox"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-sidebar-foreground">
            {current ? current.name : "Choose a mailbox"}
          </span>
          <span className="block truncate text-xs text-sidebar-muted">
            {current ? current.address : `${total} available`}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[300px] p-0">
        <Command
          // Match on the address and the sender name.
          filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          {total > 6 && <CommandInput placeholder="Find a mailbox…" />}
          <CommandList className="max-h-[360px]">
            <CommandEmpty>No mailbox matches.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.domain} heading={g.domain}>
                {g.mailboxes.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.address} ${m.name}`}
                    onSelect={() => go(m.id)}
                    className={cn("gap-2.5", !m.active && "opacity-60")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.address.slice(0, m.address.lastIndexOf("@"))}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.name}
                        {!m.active && ", turned off"}
                      </span>
                    </span>
                    {m.unread > 0 && (
                      <span className="rounded-sm bg-primary px-1.5 text-[11px] leading-[18px] font-bold text-primary-foreground tabular-nums">
                        {m.unread}
                      </span>
                    )}
                    <Check className={cn("size-4", m.id === current?.id ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
