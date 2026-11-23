import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "./command";

/* The searchable list the mailbox switcher is built on. */

const meta = { title: "Foundations/Command", component: Command, parameters: { layout: "centered" } } satisfies Meta<typeof Command>;
export default meta;
type Story = StoryObj<typeof meta>;

const List = () => (
  <Command className="w-80 rounded-lg border">
    <CommandInput placeholder="Find a mailbox…" />
    <CommandList>
      <CommandEmpty>No mailbox matches.</CommandEmpty>
      <CommandGroup heading="alpha.test">
        <CommandItem>hello@alpha.test</CommandItem>
        <CommandItem>billing@alpha.test</CommandItem>
        <CommandItem disabled>old-support@alpha.test (turned off)</CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="beta.test">
        <CommandItem>ada@beta.test</CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
);

export const Default: Story = { render: () => <List /> };
export const NothingFound: Story = {
  render: () => <List />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByPlaceholderText("Find a mailbox…"), "zzz");
    await expect(await canvas.findByText("No mailbox matches.")).toBeInTheDocument();
  },
};
