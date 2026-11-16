import type { AppContext } from "@/worker";

/*
 * Interruptors for serverAction / serverQuery. They run inside the function
 * itself, so a function is protected whatever page URL it is posted to.
 */

type Ctx = { ctx: Record<string, any> };

const mfaFirst = () => new Response("Set up two-step verification first", { status: 403 });

export const signedIn = ({ ctx }: Ctx) => {
  const user = (ctx as AppContext).user;
  if (!user) return new Response("Sign in first", { status: 401 });
  if (user.mustSetUpMfa) return mfaFirst();
};

/** Signed in, even if two-step is required and not set up yet: only for the two-step setup itself. */
export const signedInForMfaSetup = ({ ctx }: Ctx) => {
  if (!(ctx as AppContext).user) return new Response("Sign in first", { status: 401 });
};

export const adminOnly = ({ ctx }: Ctx) => {
  const user = (ctx as AppContext).user;
  if (!user) return new Response("Sign in first", { status: 401 });
  if (user.mustSetUpMfa) return mfaFirst();
  if (user.role !== "admin") return new Response("Admins only", { status: 403 });
};

/** What every form action returns: a message for a toast, or an error to show in the form. */
export type ActionResult<T = undefined> =
  | { ok: true; message?: string; redirect?: string; data?: T }
  | { ok: false; error: string };

export const ok = <T = undefined>(message?: string, extra?: { redirect?: string; data?: T }): ActionResult<T> => ({
  ok: true,
  message,
  ...extra,
});
export const fail = (error: string): ActionResult<never> => ({ ok: false, error });

export const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
