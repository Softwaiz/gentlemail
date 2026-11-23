import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./select";

const meta = { title: "Foundations/Select", component: Select, parameters: { layout: "centered" } } satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

const Options = () => (
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Role</SelectLabel>
      <SelectItem value="member">Member</SelectItem>
      <SelectItem value="admin">Admin</SelectItem>
      <SelectItem value="owner" disabled>Owner (not available)</SelectItem>
    </SelectGroup>
  </SelectContent>
);

export const Closed: Story = {
  render: (args) => (
    <Select {...args} defaultValue="member">
      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
      <Options />
    </Select>
  ),
};
export const Placeholder: Story = {
  render: (args) => (
    <Select {...args}>
      <SelectTrigger className="w-48"><SelectValue placeholder="Choose a role" /></SelectTrigger>
      <Options />
    </Select>
  ),
};
export const Open: Story = { ...Closed, args: { defaultOpen: true } };
export const Disabled: Story = { ...Closed, args: { disabled: true } };
