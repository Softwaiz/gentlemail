import type { User } from "@/lib/auth";
import { switcherGroups, unreadByFolder } from "@/lib/db";
import { type FlashCode, flashText } from "@/app/http";
import { ShellView, type ShellViewProps } from "./shell-view";

export { appName } from "./brand";
export { PageHeader } from "./shell-view";

type Props = Omit<ShellViewProps, "user" | "groups" | "unread"> & { user: User };

/** The app's frame for a signed-in page: loads the mailboxes and unread counts, then draws ShellView. */
export async function Shell({ user, mailboxId, ...rest }: Props) {
  const groups = await switcherGroups(user);
  const open = groups.some((g) => g.mailboxes.some((m) => m.id === mailboxId));
  const unread = open ? await unreadByFolder(mailboxId!) : {};
  return <ShellView user={user} groups={groups} mailboxId={mailboxId} unread={unread} {...rest} />;
}

/** The messages a redirect asked this page to show, among the codes it accepts (see FLASH in http.ts). */
export const flashFrom = (request: Request, accepted: { msg: readonly FlashCode[]; err: readonly FlashCode[] }) => {
  const u = new URL(request.url);
  return { msg: flashText(u.searchParams.get("msg"), accepted.msg), err: flashText(u.searchParams.get("err"), accepted.err) };
};
