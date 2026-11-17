"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * The sidebar's top bar and its panel. On phones the menu button opens the panel as a
 * full-screen layer in the sidebar's ink (styles: .nav-panel in styles.css): it unrolls
 * from the top and its items arrive one after another. From md up the panel is simply
 * the sidebar, always shown, and the button is hidden.
 *
 * Closes on Escape, on the close button, and when a link inside it is followed (pages
 * change without a reload, so the menu would otherwise stay open).
 */
export function SidebarNav({
  brand,
  action,
  children,
}: {
  /** Logo and name, linking home. Shown in the top bar and again at the top of the open menu. */
  brand: React.ReactNode;
  /** A button next to the menu button on phones (New message). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape in the mailbox switcher or the user menu closes only that.
      if (document.querySelector("[data-radix-popper-content-wrapper], [role='dialog'][data-state='open']")) return;
      setOpen(false);
    };
    // Capture on window runs before Radix's own Escape handling, while its popover is still there.
    window.addEventListener("keydown", onKey, true);
    document.documentElement.classList.add("nav-open"); // the page behind doesn't scroll
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.documentElement.classList.remove("nav-open");
    };
  }, [open]);

  const iconButton = "grid size-9 place-items-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent";

  return (
    <>
      <div className="flex items-center gap-2 px-2 pt-1 md:pb-3">
        <div className="flex flex-1">{brand}</div>
        {action}
        <button type="button" aria-label="Open menu" aria-expanded={open} aria-controls="nav-panel" onClick={() => setOpen(true)} className={cn(iconButton, "md:hidden")}>
          <Menu className="size-5" />
        </button>
      </div>

      <div
        id="nav-panel"
        className={cn("nav-panel scrollbar-thin flex flex-1 flex-col gap-1", open && "is-open")}
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label={open ? "Menu" : undefined}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        {/* Phones only: the open menu's own top bar, the close button where the menu button was. */}
        <div className="nav-item flex items-center gap-2 px-2 pt-1 pb-4 md:hidden" style={{ "--i": 0 } as React.CSSProperties}>
          <div className="flex flex-1">{brand}</div>
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className={iconButton}>
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
