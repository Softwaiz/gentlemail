import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "./popover";

const meta = {
  title: "Foundations/Popover",
  component: Popover,
  args: { defaultOpen: true },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Popover>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: (args) => (
    <Popover {...args}>
      <PopoverTrigger asChild><Button variant="outline">Why is this in spam?</Button></PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Marked as spam</PopoverTitle>
          <PopoverDescription>The sender failed SPF and DKIM checks for its domain.</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
};

export const NearTheEdge: Story = {
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <div className="flex h-screen items-start justify-end p-2">
      <Popover {...args}>
        <PopoverTrigger asChild><Button variant="outline">Details</Button></PopoverTrigger>
        <PopoverContent>Kept on screen near the corner.</PopoverContent>
      </Popover>
    </div>
  ),
};
