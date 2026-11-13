"use server";

import { requestInfo, serverQuery } from "rwsdk/worker";
import { signedIn } from "@/app/actions/guards";
import { switcherGroups } from "@/lib/db";

/** Fresh mailbox list with unread counts for the switcher. Data only: the page isn't re-rendered. */
export const getSwitcherGroups = serverQuery([signedIn, async () => switcherGroups(requestInfo.ctx.user!)]);
