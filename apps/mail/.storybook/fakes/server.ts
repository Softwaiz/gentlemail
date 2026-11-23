/** How fake server actions answer: set from the "Server" toolbar, or a story's `parameters.server`. */
export type ServerMode = "ok" | "fail" | "slow";

export const server = { mode: "ok" as ServerMode };

/** Answers like a server function: after a short wait, long when slow; an error when failing. */
export async function answer<T>(result: T, error = "Something went wrong on the server."): Promise<T | { ok: false; error: string }> {
  await new Promise((r) => setTimeout(r, server.mode === "slow" ? 2500 : 300));
  return server.mode === "fail" ? { ok: false, error } : result;
}

/** The fake for a serverAction with no specific answer: logs its input, then answers ok. */
export const fakeAction =
  (name: string) =>
  async (...input: unknown[]) => {
    console.info(`[fake] ${name}`, ...input);
    return answer({ ok: true as const });
  };

/** The fake for a serverQuery with no specific answer: answers nothing, so components keep their data. */
export const fakeQuery =
  (name: string) =>
  async (...input: unknown[]) => {
    console.info(`[fake] ${name}`, ...input);
    return answer(undefined);
  };
