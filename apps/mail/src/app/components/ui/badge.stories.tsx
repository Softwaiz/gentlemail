import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge";

const meta = {
  title: "Foundations/Badge",
  component: Badge,
  parameters: { layout: "centered" },
  args: { children: "Admin" },
  argTypes: { variant: { control: "select", options: ["default", "secondary", "destructive", "outline", "ghost", "link"] } },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      {(["default", "secondary", "destructive", "outline", "ghost", "link"] as const).map((v) => (
        <Badge key={v} {...args} variant={v}>{v}</Badge>
      ))}
    </div>
  ),
};
export const Counts: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {[1, 9, 99, 1234].map((n) => <Badge key={n}>{n}</Badge>)}
    </div>
  ),
};
export const TurnedOff: Story = { args: { variant: "outline", children: "Turned off" } };
