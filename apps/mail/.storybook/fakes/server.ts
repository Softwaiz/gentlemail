/** How fake server actions answer: set from the "Server" toolbar, or a story's `parameters.server`. */
export type ServerMode = "ok" | "fail" | "slow";

export const server = { mode: "ok" as ServerMode };

/** Answers like a server function: after a short wait, long when slow; an error when failing. */
export async function answer<T>(result: T, error = "Something went wrong on the server."): Promise<T | { ok: false; error: string }> {
  await new Promise((r) => setTimeout(r, server.mode === "slow" ? 2500 : 300));
  return server.mode === "fail" ? { ok: false, error } : result;
}

/** The fake for a serverAction with no specific answer: answers ok. Logs its name, never its input (it can be a password). */
export const fakeAction =
  (name: string) =>
  async () => {
    console.info(`[fake] ${name}`);
    return answer({ ok: true as const });
  };

/** The fake for a serverQuery with no specific answer: answers nothing, so components keep their data. Failing, it throws: a query has no error answer. */
export const fakeQuery =
  (name: string) =>
  async () => {
    console.info(`[fake] ${name}`);
    await answer(undefined);
    if (server.mode === "fail") throw new Error("Something went wrong on the server.");
  };
