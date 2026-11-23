/**
 * Stands in for the Worker's `env` in stories. Only plain settings live here; there is no
 * database, bucket or mail binding, so a component that reaches for one fails loudly.
 * Stories change APP_NAME with the "Name" toolbar (see preview.tsx).
 */
export const env: Record<string, unknown> = { APP_NAME: "GentleMail" };
