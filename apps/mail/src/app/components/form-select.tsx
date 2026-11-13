"use client";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { cn } from "@/lib/utils";

export type Option = { value: string; label: string; hint?: string };

/** shadcn Select that submits with its form (Radix renders a hidden native select for `name`). */
export function FormSelect({
  name,
  options,
  groups,
  defaultValue,
  placeholder,
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  name: string;
  options?: Option[];
  /** Grouped options, e.g. mailboxes per domain. */
  groups?: { label: string; options: Option[] }[];
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const item = (o: Option) => (
    <SelectItem key={o.value} value={o.value}>
      {o.label}
      {o.hint && <span className="text-muted-foreground">{o.hint}</span>}
    </SelectItem>
  );
  return (
    <Select name={name} defaultValue={defaultValue} disabled={disabled} required>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options?.map(item)}
        {groups?.map((g) => (
          <SelectGroup key={g.label}>
            <SelectLabel>{g.label}</SelectLabel>
            {g.options.map(item)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
