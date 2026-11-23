import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import type { SwitcherGroup } from "@/lib/db";
import { type ListItem, MessageList } from "./message-list";
import { PageHeader, ShellView } from "./shell-view";

/** Made-up mailboxes over two domains, one of them turned off. */
const groups: SwitcherGroup[] = [
  {
    domain: "acme.test",
    mailboxes: [
      { id: "hello", address: "hello@acme.test", name: "Acme", unread: 3, active: true },
      { id: "billing", address: "billing@acme.test", name: "Billing", unread: 0, active: true },
      { id: "old", address: "old-support@acme.test", name: "Old support", unread: 0, active: false },
    ],
  },
  {
    domain: "softwaiz.test",
    mailboxes: [{ id: "ada", address: "ada@softwaiz.test", name: "Ada Lovelace", unread: 12, active: true }],
  },
];

const admin = { name: "Ada Lovelace", email: "ada@softwaiz.test", role: "admin" as const };
const member = { name: "Grace Hopper", email: "grace@acme.test", role: "member" as const };

const Placeholder = () => (
  <>
    <PageHeader title="Inbox" sub="hello@acme.test" />
    <div className="grid h-64 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">The page goes here</div>
  </>
);

const meta = {
  title: "App/Sidebar and frame",
  component: ShellView,
  parameters: { toaster: false }, // the frame has its own
  args: {
    user: admin,
    groups,
    mailboxId: "hello",
    folder: "inbox",
    unread: { inbox: 3, archive: 1, spam: 2, trash: 0 },
    children: <Placeholder />,
  },
  argTypes: {
    folder: { control: "select", options: ["inbox", "sent", "archive", "spam", "trash", "settings", "admin", "api", "security"] },
    children: { control: false },
  },
} satisfies Meta<typeof ShellView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inbox: Story = {};

/** Sent never gets a badge, even with unread mail in it. */
export const SentSelected: Story = { args: { folder: "sent", unread: { inbox: 3, sent: 5 } } };
export const SettingsSelected: Story = { args: { folder: "settings" } };
export const AdminSelected: Story = { args: { folder: "admin", mailboxId: undefined } };
export const NoUnread: Story = { args: { unread: {} } };

/** A lot of unread mail: the badge shows the full number, there is no "99+" today. */
export const ManyUnread: Story = { args: { unread: { inbox: 1234, spam: 87, archive: 99 } } };

/** A member: no Admin, no API & webhooks, no version. */
export const Member: Story = { args: { user: member, groups: [groups[0]] } };

/** Signed in, but no mailbox to open yet. */
export const NoMailbox: Story = { args: { user: member, groups: [], mailboxId: undefined, folder: undefined } };

export const LongAddress: Story = {
  args: {
    groups: [
      {
        domain: "a-very-long-subdomain.example-company.test",
        mailboxes: [
          {
            id: "long",
            address: "customer-support-and-billing-questions@a-very-long-subdomain.example-company.test",
            name: "Customer support and billing questions",
            unread: 4,
            active: true,
          },
        ],
      },
    ],
    mailboxId: "long",
  },
};

export const WithMessage: Story = { args: { flash: { msg: "Settings saved." } } };
export const WithError: Story = { args: { flash: { err: "That mailbox is turned off. Turn it on to send from it." } } };

/** Opens the mailbox switcher: both domains, the turned-off mailbox dimmed. */
export const SwitcherOpen: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByLabelText("Switch mailbox"));
    await expect(await screen.findByText("old-support")).toBeInTheDocument();
  },
};

/* ---------- On a phone ---------- */

export const Phone: Story = { globals: { viewport: { value: "phone" } } };

/** The menu opened from the top bar, items coming in one after another. */
export const PhoneMenuOpen: Story = {
  globals: { viewport: { value: "phone" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText("Open menu"));
    // Checks the menu is open, not how far its slide-in animation has got.
    await expect(canvas.getByLabelText("Open menu")).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
  },
};

/* ---------- With real content ---------- */

const threads: ListItem[] = [
  ["Ada Lovelace", "Quarterly numbers", "09:41", true],
  ["Grace Hopper", "Lunch on Friday?", "Yesterday", true],
  ["Linus Torvalds", "Re: the build is red", "Nov 19", false],
  ["Margaret Hamilton", "Invoice 2026-114", "Nov 18", false],
].map(([who, subject, date, unread], n) => ({
  key: `t${n}`,
  threadId: `t${n}`,
  folder: "inbox",
  who: who as string,
  subject: subject as string,
  snippet: "Here are the figures you asked for. Let me know if anything looks off.",
  date: date as string,
  unread: unread as boolean,
  starred: n === 1,
  attachments: n === 3,
  count: n === 0 ? 3 : 1,
}));

/** The sidebar around the message list. Not yet the inbox page itself: mailbox.tsx isn't split, so its header and search are missing. */
export const WithMessageList: Story = {
  args: { bleed: true, children: <MessageList mailboxId="hello" folder="inbox" scope="thread" items={threads} /> },
};
export const WithMessageListOnPhone: Story = { ...WithMessageList, globals: { viewport: { value: "phone" } } };
