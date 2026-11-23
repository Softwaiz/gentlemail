import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ComposeForm } from "./compose-form";
import { RichEditor } from "./rich-editor";

const meta = {
  title: "App/Compose form",
  component: ComposeForm,
  args: {
    discardHref: "#",
    children: (
      <>
        <input name="to" aria-label="To" className="h-11 w-full border-b bg-transparent px-5 text-sm outline-none" />
        <input name="subject" aria-label="Subject" className="h-11 w-full border-b bg-transparent px-5 text-sm outline-none" />
        <RichEditor />
      </>
    ),
  },
} satisfies Meta<typeof ComposeForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

/** Enter in a field never sends the message: only the Send button does. */
export const EnterDoesNotSend: Story = {
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    let sent = 0;
    canvasElement.querySelector("form")!.addEventListener("submit", () => sent++);
    await step("Enter in To and in Subject", async () => {
      await userEvent.type(canvas.getByLabelText("To"), "anna@example.com{Enter}");
      await userEvent.type(canvas.getByLabelText("Subject"), "Hello{Enter}");
      await expect(sent).toBe(0);
    });
    await step("the Send button", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Send" }));
      await expect(sent).toBe(1);
    });
  },
};
