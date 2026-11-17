"use client";

import { KeyRound, LogOut, Monitor, Moon, Shield, Sun } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

const themeLabel: Record<Theme, { label: string; Icon: typeof Moon }> = {
  dark: { label: "Dark", Icon: Moon },
  light: { label: "Light", Icon: Sun },
  system: { label: "Same as device", Icon: Monitor },
};

/** Applies at once and is remembered for a year in this browser; the server reads it on the next page load. */
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function UserMenu({ name, email, isAdmin }: { name: string; email: string; isAdmin: boolean }) {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document === "undefined" ? "dark" : ((document.documentElement.dataset.theme as Theme) ?? "dark"),
  );
  const logout = () => {
    const f = document.createElement("form");
    f.method = "post";
    f.action = "/logout";
    document.body.appendChild(f);
    f.submit();
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-violet">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-lime text-[13px] font-bold text-lime-ink">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-sidebar-foreground">{name}</span>
          <span className="block truncate text-xs text-sidebar-muted">{email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate font-semibold">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isAdmin && (
          <DropdownMenuItem asChild>
            <a href="/admin">
              <Shield /> Admin
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href="/account/security">
            <KeyRound /> Security
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(v) => {
            setTheme(v as Theme);
            applyTheme(v as Theme);
          }}
        >
          {THEMES.map((t) => {
            const { label, Icon } = themeLabel[t];
            return (
              <DropdownMenuRadioItem key={t} value={t} onSelect={(e) => e.preventDefault()}>
                <Icon /> {label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout}>
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
