"use client";

import { KeyRound, Languages, LogOut, Monitor, Moon, Shield, Sun } from "lucide-react";
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
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, type Locale, i18n } from "@/lib/i18n";
import { setLanguageAction } from "@/app/actions/language";
import { msg, t } from "@lingui/core/macro";

const themeLabel = {
  dark: { label: msg({ id: "menu.theme_dark", message: "Dark" }), Icon: Moon },
  light: { label: msg({ id: "menu.theme_light", message: "Light" }), Icon: Sun },
  system: { label: msg({ id: "menu.theme_system", message: "Same as device" }), Icon: Monitor },
} as const;

/** Saved on the account (every device follows it) and in this browser's cookie, then the page reloads in it. */
async function applyLanguage(language: Locale | null) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = language
    ? `${LOCALE_COOKIE}=${language}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
    : `${LOCALE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  try {
    await setLanguageAction(language);
  } finally {
    location.reload();
  }
}

/** Applies at once and is remembered for a year in this browser; the server reads it on the next page load. */
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function UserMenu({ name, email, isAdmin, language }: { name: string; email: string; isAdmin: boolean; language: string | null }) {
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
              <Shield /> {t({ id: "menu.admin", message: "Admin" })}
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href="/account/security">
            <KeyRound /> {t({ id: "menu.security", message: "Security" })}
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t({ id: "menu.theme", message: "Theme" })}</DropdownMenuLabel>
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
                <Icon /> {i18n._(label)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t({ id: "menu.language", message: "Language" })}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={language ?? "browser"} onValueChange={(v) => applyLanguage(v === "browser" ? null : (v as Locale))}>
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} lang={l} onSelect={(e) => e.preventDefault()}>
              <Languages /> {LOCALE_NAMES[l]}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value="browser" onSelect={(e) => e.preventDefault()}>
            <Monitor /> {t({ id: "menu.language_browser", message: "Same as browser" })}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout}>
          <LogOut /> {t({ id: "menu.logout", message: "Log out" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
