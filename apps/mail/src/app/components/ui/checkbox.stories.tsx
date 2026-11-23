import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./checkbox";
import { Label } from "./label";

const meta = {
  title: "Foundations/Checkbox",
  component: Checkbox,
  parameters: { layout: "centered" },
  args: { disabled: false },
} satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};
export const On: Story = { args: { defaultChecked: true } };
export const Indeterminate: Story = { args: { checked: "indeterminate" } };
export const Disabled: Story = { args: { disabled: true, defaultChecked: true } };
export const WithLabelAndDescription: Story = {
  render: (args) => (
    <div className="flex max-w-sm items-start gap-3">
      <Checkbox id="send" {...args} defaultChecked />
      <div className="grid gap-1">
        <Label htmlFor="send">Send</Label>
        <p className="text-xs text-muted-foreground">The key can send mail from this mailbox.</p>
      </div>
    </div>
  ),
};
