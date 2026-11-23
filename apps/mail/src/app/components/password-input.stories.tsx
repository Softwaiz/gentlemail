import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { PasswordInput } from "./password-input";

const meta = {
  title: "Foundations/Password input",
  component: PasswordInput,
  parameters: { layout: "centered" },
  args: { "aria-label": "Password", defaultValue: "correct horse" },
  decorators: [(Story) => <div className="w-72"><Story /></div>],
} satisfies Meta<typeof PasswordInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hidden: Story = {};
export const Empty: Story = { args: { defaultValue: "", placeholder: "10 characters or more" } };
export const Invalid: Story = { args: { "aria-invalid": true } };
export const Disabled: Story = { args: { disabled: true } };
/** The setup token's field: the button says so. */
export const Token: Story = { args: { kind: "token", "aria-label": "Setup token" } };

/** Shown, then hidden again: the text survives. */
export const ShowAndHide: Story = {
  globals: { language: "en" }, // the check reads the English labels
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Password");
    const button = canvas.getByRole("button", { name: "Show password" });
    await expect(input).toHaveAttribute("type", "password");
    await userEvent.click(button);
    await expect(input).toHaveAttribute("type", "text");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button);
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveValue("correct horse");
  },
};
