import type { Meta, StoryObj } from "@storybook/react-vite";
import { Label } from "./label";
import { Switch } from "./switch";

const meta = {
  title: "Foundations/Switch",
  component: Switch,
  parameters: { layout: "centered" },
  args: { disabled: false },
  argTypes: { size: { control: "inline-radio", options: ["sm", "default"] } },
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};
export const On: Story = { args: { defaultChecked: true } };
export const Disabled: Story = { args: { disabled: true } };
export const Small: Story = { args: { size: "sm", defaultChecked: true } };
export const WithLabelAndDescription: Story = {
  render: (args) => (
    <div className="flex max-w-sm items-start justify-between gap-6">
      <div className="grid gap-1">
        <Label htmlFor="mfa">Require two-step for everyone</Label>
        <p className="text-xs text-muted-foreground">People without it can only open Security until they set it up.</p>
      </div>
      <Switch id="mfa" {...args} />
    </div>
  ),
};
