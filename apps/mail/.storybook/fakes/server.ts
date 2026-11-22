/** How fake server actions answer: set from the "Server" toolbar, or a story's `parameters.server`. */
export type ServerMode = "ok" | "fail" | "slow";

export const server = { mode: "ok" as ServerMode };

/** Answers like a server action: after a short wait, long when slow; an error when failing. */
export async function answer<T>(result: T, error = "Something went wrong on the server."): Promise<T | { ok: false; error: string }> {
  await new Promise((r) => setTimeout(r, server.mode === "slow" ? 2500 : 300));
  return server.mode === "fail" ? { ok: false, error } : result;
}
