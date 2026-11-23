import type { Meta, StoryObj } from "@storybook/react-vite";
import { toast } from "sonner";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { Button } from "./button";
import { Toaster } from "./sonner";

/* Toasts: the answers to actions. The Toaster is in every story (preview.tsx); here they're raised by hand. */

const meta = { title: "Foundations/Toast", component: Toaster, parameters: { layout: "centered" } } satisfies Meta<typeof Toaster>;
export default meta;
type Story = StoryObj<typeof meta>;

const LONG = "Marked as spam. Future mail from this sender goes to spam, and the sender is added to the blocked list in mailbox settings.";

export const Kinds: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => toast("Draft saved.")}>Plain</Button>
      <Button variant="outline" onClick={() => toast.success("Archived.")}>Success</Button>
      <Button variant="outline" onClick={() => toast.error("That didn't work. Check your connection and try again.")}>Error</Button>
      <Button variant="outline" onClick={() => toast.success(LONG)}>Long text</Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Success" }));
    await userEvent.click(canvas.getByRole("button", { name: "Error" }));
    const error = await screen.findByText(/That didn't work/);
    await waitFor(() => expect(error).toBeVisible()); // toasts fade in
  },
};
