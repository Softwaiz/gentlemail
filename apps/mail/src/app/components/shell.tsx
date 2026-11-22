import type { User } from "@/lib/auth";
import { switcherGroups, unreadByFolder } from "@/lib/db";
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

export const flashFrom = (request: Request) => {
  const u = new URL(request.url);
  return { msg: u.searchParams.get("msg"), err: u.searchParams.get("err") };
};
