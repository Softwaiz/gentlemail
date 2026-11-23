import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./input";
import { Label } from "./label";

const meta = {
  title: "Foundations/Input",
  component: Input,
  parameters: { layout: "padded" },
  args: { placeholder: "name@example.com", type: "email", disabled: false },
  decorators: [(Story) => <div className="max-w-sm"><Story /></div>],
} satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Filled: Story = { args: { defaultValue: "ada@alpha.test" } };
export const Disabled: Story = { args: { defaultValue: "ada@alpha.test", disabled: true } };
export const Invalid: Story = { args: { defaultValue: "ada@", "aria-invalid": true } };
export const Password: Story = { args: { type: "password", defaultValue: "correct horse", placeholder: undefined } };

/** With its label, a hint and an error, as the forms lay them out. */
export const WithLabelHintAndError: Story = {
  render: (args) => (
    <div className="grid gap-1.5">
      <Label htmlFor="address">Address</Label>
      <Input id="address" {...args} defaultValue="support" aria-invalid aria-describedby="address-hint address-err" />
      <p id="address-hint" className="text-xs text-muted-foreground">The part before @alpha.test.</p>
      <p id="address-err" className="text-xs font-medium text-destructive">This address is already taken.</p>
    </div>
  ),
};
