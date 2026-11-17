import { cn } from "@/lib/utils";

/** A titled card block used across the admin pages. */
export function Section({
  title,
  description,
  action,
  children,
  className,
  tone,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  tone?: "danger";
}) {
  return (
    <section className={cn("min-w-0 rounded-lg border bg-card", tone === "danger" && "border-destructive/35", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-5 sm:px-6">
        <div>
          <h2 className={cn("text-base font-semibold tracking-[-0.01em]", tone === "danger" && "text-destructive")}>{title}</h2>
          {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="px-4 pt-4 pb-5 sm:px-6 sm:pb-6">{children}</div>
    </section>
  );
}

/** `label` names the badge below lg, where table headers are hidden ("Two-step  On"). */
export function StatusBadge({
  on,
  onLabel = "Active",
  offLabel = "Disabled",
  label,
}: {
  on: boolean;
  onLabel?: string;
  offLabel?: string;
  label?: string;
}) {
  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium",
        on ? "bg-lime/25 text-foreground dark:bg-lime/15 dark:text-lime" : "bg-muted text-muted-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", on ? "bg-unread" : "bg-muted-foreground/50")} />
      {on ? onLabel : offLabel}
    </span>
  );
  if (!label) return badge;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground lg:hidden">{label}</span>
      {badge}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

/*
 * Tables in a Section turn into a list of small cards on phones and tablets (below lg): the header row is hidden and
 * each row becomes a grid. Pages place the cells with max-lg: column and row classes.
 */
export const cardTable = "max-lg:block max-lg:[&_tbody]:block";
export const cardTableHeader = "max-lg:hidden";
export const cardRow = "max-lg:grid max-lg:items-center max-lg:gap-x-3 max-lg:gap-y-1.5 max-lg:py-3 max-lg:[&>td]:p-0";
