import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpdateCheck } from "./update-check";

const meta = {
  title: "App/Update check",
  component: UpdateCheck,
  decorators: [
    (Story) => (
      <div className="m-4 max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UpdateCheck>;

export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = { args: { on: true } };
export const Off: Story = { args: { on: false } };
export const French: Story = { args: { on: true }, globals: { language: "fr" } };
