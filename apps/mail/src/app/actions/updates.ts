"use server";

import { requestInfo, serverAction } from "rwsdk/worker";
import { type ActionResult, adminOnly, fail, ok } from "@/app/actions/guards";
import { closeUpdateNews, setUpdateCheck, updateNews } from "@/lib/updates";
import { t } from "@lingui/core/macro";

/** Closes the notice for the newest version, for this person. A newer one brings it back. */
export const updateLater = serverAction([
  adminOnly,
  async (): Promise<ActionResult> => {
    const user = requestInfo.ctx.user!;
    const news = await updateNews(user);
    if (news) await closeUpdateNews(user.id, news.releases[0].version);
    return ok();
  },
]);

export const setUpdateCheckAction = serverAction([
  adminOnly,
  async (_id: string, on: boolean): Promise<ActionResult> => {
    if (typeof on !== "boolean") return fail("on must be true or false");
    await setUpdateCheck(on);
    return ok(on ? t({ id: "updates.on_done", message: "GentleMail checks for new versions." }) : t({ id: "updates.off_done", message: "GentleMail no longer checks for new versions." }));
  },
]);
