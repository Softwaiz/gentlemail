import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { type ListItem, MessageList } from "./message-list";

/** Made-up threads. Dates are fixed strings, so screenshots don't change from one day to the next. */
const thread = (n: number, over: Partial<ListItem> = {}): ListItem => ({
  key: `t${n}`,
  threadId: `t${n}`,
  folder: "inbox",
  who: ["Ada Lovelace", "Grace Hopper", "Linus Torvalds", "Margaret Hamilton", "Alan Turing"][n % 5],
  subject: ["Quarterly numbers", "Lunch on Friday?", "Re: the build is red", "Invoice 2026-114", "Your domain is verified"][n % 5],
  snippet: "Here are the figures you asked for. Let me know if anything looks off before the meeting.",
  date: ["09:41", "Yesterday", "Nov 19", "Nov 18", "Nov 2"][n % 5],
  unread: false,
  starred: false,
  attachments: false,
  count: 1,
  ...over,
});

const inbox: ListItem[] = [
  thread(0, { unread: true, count: 3 }),
  thread(1, { unread: true, starred: true }),
  thread(2, { attachments: true }),
  thread(3, { starred: true, attachments: true }),
  thread(4),
];

const meta = {
  title: "App/Message list",
  component: MessageList,
  args: { mailboxId: "mb1", folder: "inbox", scope: "thread", items: inbox, showFolder: false },
  argTypes: {
    folder: { control: "select", options: ["inbox", "sent", "archive", "spam", "trash"] },
    scope: { control: "inline-radio", options: ["thread", "message"] },
  },
  decorators: [(Story) => <div className="flex min-h-screen flex-col bg-background text-foreground"><Story /></div>],
} satisfies Meta<typeof MessageList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inbox: Story = {};

export const AllRead: Story = { args: { items: inbox.map((i) => ({ ...i, unread: false })) } };

export const LongSubjectsAndNames: Story = {
  args: {
    items: [
      thread(0, {
        unread: true,
        who: "The Extremely Long Name of a Committee That Sends Newsletters",
        subject: "A subject line that keeps going well past the width of any reasonable screen, to see where it cuts",
      }),
      thread(1, { who: "x", subject: "" }),
    ],
  },
};

export const ManyThreads: Story = { args: { items: Array.from({ length: 60 }, (_, n) => thread(n, { unread: n % 4 === 0 })) } };

export const Spam: Story = { args: { folder: "spam", items: inbox.map((i) => ({ ...i, folder: "spam" })) } };

export const SearchResults: Story = {
  args: { scope: "message", showFolder: true, items: inbox.map((i, n) => ({ ...i, folder: ["inbox", "sent", "archive", "trash", "spam"][n] })) },
};

/** Selects two threads and archives them: the fake server answers, and a toast says what happened. */
export const ArchiveTwo: Story = {
  play: async ({ canvasElement, step, parameters }) => {
    const canvas = within(canvasElement);
    await step("Select two threads", async () => {
      await userEvent.click(canvas.getByLabelText("Select Quarterly numbers"));
      await userEvent.click(canvas.getByLabelText("Select Lunch on Friday?"));
      await expect(canvas.getByText("2 selected")).toBeVisible();
    });
    await step("Archive them", async () => {
      // The toolbar's button comes first; each row also has one, shown on hover.
      await userEvent.click(canvas.getAllByRole("button", { name: "Archive" })[0]);
    });
    await step("See what the server said", async () => {
      const said = parameters.server === "fail" ? "Something went wrong on the server." : "Archived.";
      // Toasts are drawn at the edge of the page, outside the story.
      const toast = await screen.findByText(said);
      await waitFor(() => expect(toast).toBeVisible()); // it fades in
    });
  },
};

/** The same, with the server failing: the error toast. */
export const ArchiveFails: Story = { ...ArchiveTwo, parameters: { server: "fail" } };
