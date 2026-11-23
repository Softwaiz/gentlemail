import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
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

/** The text goes away while a link is being added (by keyboard, for example): the link is still added. */
export const LinkAfterTheTextChanged: Story = {
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const body = canvas.getByLabelText("Message");
    await step("opens the link card", async () => {
      await userEvent.click(body);
      await userEvent.type(body, "Hello there");
      await userEvent.keyboard("{Control>}k{/Control}");
      await waitFor(() => expect(canvas.getByLabelText("Link address")).toHaveFocus());
    });
    await step("the text is undone meanwhile", async () => {
      body.focus();
      for (let i = 0; i < 20 && body.textContent; i++) await userEvent.keyboard("{Control>}z{/Control}");
      await waitFor(() => expect(body).toHaveTextContent(/^$/));
    });
    await step("the link is added", async () => {
      const address = canvas.getByLabelText<HTMLInputElement>("Link address");
      address.focus();
      await fireEvent.change(address, { target: { value: "example.com" } });
      await waitFor(() => expect(address).toHaveValue("example.com"));
      await fireEvent.keyDown(address, { key: "Enter" });
      await waitFor(() => expect(within(body).getByRole("link")).toHaveAttribute("href", "https://example.com"));
    });
  },
};

/** Throws while the editor is drawn, when the button is pressed. */
function Breaks() {
  const [broken, setBroken] = useState(false);
  if (broken) throw new Error("made up, for this story");
  return <button type="button" onClick={() => setBroken(true)} className="px-5 py-2 text-sm underline">Break the editor</button>;
}

/** An error in the editor leaves the page, and the text in a plain field. */
export const EditorFails: Story = {
  args: { children: <Breaks /> },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step("the text is kept, ready to go on", async () => {
      const body = canvas.getByLabelText("Message");
      await userEvent.click(body);
      await userEvent.type(body, "Hello Anna{Enter}see you Thursday");
      await userEvent.click(canvas.getByRole("button", { name: "Break the editor" }));
      const field = await canvas.findByRole("textbox", { name: "Message" });
      await waitFor(() => expect(canvas.getByRole("textbox", { name: "Message" })).toHaveValue("Hello Anna\nsee you Thursday"));
      await expect(field.tagName).toBe("TEXTAREA");
      await expect(canvas.getByRole("textbox", { name: "Message" })).toHaveFocus();
      await expect(canvas.getByRole("alert")).toBeVisible();
    });
    await step("it's posted as plain text", async () => {
      await userEvent.type(canvas.getByRole("textbox", { name: "Message" }), ", Sam", { skipClick: true });
      const form = new FormData(canvasElement.querySelector("form")!);
      await expect(form.get("body")).toBe("Hello Anna\nsee you Thursday, Sam");
      await expect(form.get("html")).toBeNull();
    });
  },
};
