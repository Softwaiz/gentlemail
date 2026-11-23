import type { Meta, StoryObj } from "@storybook/react-vite";
import { Textarea } from "./textarea";

const meta = {
  title: "Foundations/Textarea",
  component: Textarea,
  parameters: { layout: "padded" },
  args: { placeholder: "Write a signature…", disabled: false },
  decorators: [(Story) => <div className="max-w-md"><Story /></div>],
} satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Filled: Story = { args: { defaultValue: "Ada Lovelace\nAnalytical Engines Ltd\n+44 20 0000 0000" } };
export const Disabled: Story = { args: { defaultValue: "Read only", disabled: true } };
export const Invalid: Story = { args: { defaultValue: "x".repeat(400), "aria-invalid": true } };
