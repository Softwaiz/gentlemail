"use server";

import { env } from "cloudflare:workers";
import { requestInfo, serverAction } from "rwsdk/worker";
import { type ActionResult, fail, ok, signedIn } from "@/app/actions/guards";

/** Disconnects an assistant connected by signing in: your own, or anyone's if you are an admin. */
export const disconnectAssistantAction = serverAction([
  signedIn,
  async (id: string): Promise<ActionResult> => {
    const user = requestInfo.ctx.user!;
    // Its grants and tokens go with it (ON DELETE CASCADE).
    const { meta } = await env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND user_id IS NOT NULL AND (user_id = ? OR ? = 'admin')")
      .bind(id, user.id, user.role)
      .run();
    if (!meta.changes) return fail("This assistant is already disconnected.");
    return ok("Disconnected. The assistant is refused from its next request.");
  },
]);
