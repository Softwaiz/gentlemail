"use server";

import { env } from "cloudflare:workers";
import { requestInfo, serverAction } from "rwsdk/worker";
import { type ActionResult, fail, ok, signedIn } from "@/app/actions/guards";

/** Disconnects an assistant connected by signing in: your own, or anyone's if you are an admin. */
export const disconnectAssistantAction = serverAction([
  signedIn,
  async (id: string): Promise<ActionResult> => {
    const user = requestInfo.ctx.user!;
    const mine = "id = ?1 AND user_id IS NOT NULL AND (user_id = ?2 OR ?3 = 'admin')";
    const [, { meta }] = await env.DB.batch([
      // Its sign-ins not yet traded for tokens too, or the app could connect again with one within minutes.
      env.DB.prepare(
        `DELETE FROM oauth_codes WHERE EXISTS (SELECT 1 FROM api_keys WHERE ${mine} AND client_id = oauth_codes.client_id AND user_id = oauth_codes.user_id)`,
      ).bind(id, user.id, user.role),
      // Its grants and tokens go with it (ON DELETE CASCADE).
      env.DB.prepare(`DELETE FROM api_keys WHERE ${mine}`).bind(id, user.id, user.role),
    ]);
    if (!meta.changes) return fail("This assistant is already disconnected.");
    return ok("Disconnected. The assistant is refused from its next request.");
  },
]);
