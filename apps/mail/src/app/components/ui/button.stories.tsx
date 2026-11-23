import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, Trash2 } from "lucide-react";
import { Button } from "./button";

const meta = {
  title: "Foundations/Button",
  component: Button,
  parameters: { layout: "centered" },
  args: { children: "Send", disabled: false },
  argTypes: {
    variant: { control: "select", options: ["default", "destructive", "outline", "secondary", "ghost", "link"] },
    size: { control: "select", options: ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3 p-6">
      {(["default", "destructive", "outline", "secondary", "ghost", "link"] as const).map((v) => (
        <Button key={v} {...args} variant={v}>
          {v}
        </Button>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3 p-6">
      {(["xs", "sm", "default", "lg"] as const).map((s) => (
        <Button key={s} {...args} size={s}>
          Size {s}
        </Button>
      ))}
    </div>
  ),
};

export const WithIcon: Story = {
  args: { variant: "outline", children: <><Archive /> Archive</> },
};

export const IconOnly: Story = {
  args: { variant: "ghost", size: "icon", "aria-label": "Trash", children: <Trash2 /> },
};
