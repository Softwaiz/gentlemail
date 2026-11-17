/** The colour theme each person picks in their user menu, kept in a cookie (no account setting needed). */
export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "theme";

/** Dark unless the cookie says otherwise. */
export function themeFrom(cookieHeader: string | null): Theme {
  const m = cookieHeader?.match(/(?:^|;\s*)theme=([a-z]+)/);
  return m && (THEMES as readonly string[]).includes(m[1]) ? (m[1] as Theme) : "dark";
}
