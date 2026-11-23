import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { RichEditor } from "./rich-editor";

const meta = {
  title: "App/Rich editor",
  component: RichEditor,
  decorators: [
    (Story) => (
      <form className="m-4 rounded-lg border bg-card">
        <Story />
      </form>
    ),
  ],
} satisfies Meta<typeof RichEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

/** Keeps typing with the pointer over a typed address, in and after it: the editor stays, and so does the text. */
export const TypingOverALink: Story = {
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const body = canvas.getByRole("textbox");
    const address = () => within(body).getByRole("link", { name: "anna@example.com" });
    await step("a typed address links itself", async () => {
      await userEvent.click(body);
      await userEvent.type(body, "Write to anna@example.com");
      await waitFor(() => expect(address()).toBeVisible());
    });
    await step("the pointer on it shows its card", async () => {
      await userEvent.hover(address());
      await waitFor(() => expect(canvas.getByTitle("Open anna@example.com")).toBeVisible());
    });
    await step("typing on changes nothing but the text", async () => {
      await userEvent.type(body, " and tell me", { skipClick: true });
      await waitFor(() => expect(canvas.getByRole("textbox")).toHaveTextContent("Write to anna@example.com and tell me"));
    });
  },
};
