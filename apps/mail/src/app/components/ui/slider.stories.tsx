import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Slider } from "./slider";

const meta = {
  title: "Foundations/Slider",
  component: Slider,
  parameters: { layout: "centered" },
  args: { defaultValue: [40], "aria-label": "Width", disabled: false },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Slider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const AtMinimum: Story = { args: { defaultValue: [0] } };
export const AtMaximum: Story = { args: { defaultValue: [100] } };
export const TwoThumbs: Story = { args: { defaultValue: [25, 75] } };
export const Disabled: Story = { args: { disabled: true } };

/** The arrow keys move it by one step, Shift and an arrow by ten. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const thumb = within(canvasElement).getByRole("slider", { name: "Width" });
    thumb.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(thumb).toHaveAttribute("aria-valuenow", "41");
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await expect(thumb).toHaveAttribute("aria-valuenow", "51");
  },
};
