import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { SignatureFields } from "./signature-fields";

const LOGO = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" rx="8" fill="#2f5bea"/></svg>')}`;
const TEXT = '<p style="margin:0"><strong>Anna Example</strong></p><p style="margin:0">Head of Sales, <a href="https://example.com">example.com</a></p>';

const meta = {
  title: "App/Signature fields",
  component: SignatureFields,
  decorators: [
    (Story) => (
      <form className="m-4 max-w-2xl">
        <Story />
      </form>
    ),
  ],
} satisfies Meta<typeof SignatureFields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { look: { html: "", text: "", line: true, logo: null } } };

/** From before formatting: its words, with the line. */
export const PlainText: Story = { args: { look: { html: "", text: "Anna\nhttps://example.com", line: true, logo: null } } };

export const WithLogo: Story = {
  args: { look: { html: TEXT, text: "Anna Example", line: true, logo: { src: LOGO, width: 120, ratio: 0.5, link: "https://example.com", position: "left", alt: "Example" } } },
};

export const LogoAbove: Story = {
  args: { look: { html: TEXT, text: "Anna Example", line: false, logo: { src: LOGO, width: 160, ratio: 0.5, link: "", position: "above", alt: "Example" } } },
};

/** What is written, the logo and the line show in the preview at once, and are posted with the form. */
export const Editing: Story = {
  ...WithLogo,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const preview = () => canvasElement.querySelector<HTMLElement>(".signature-view")!;
    await step("starts from what is saved", async () => {
      await waitFor(() => expect(canvas.getByRole("textbox", { name: "Signature" })).toHaveTextContent("Anna Example"));
      const form = new FormData(canvasElement.querySelector("form")!);
      await expect(String(form.get("signature_html"))).toContain('href="https://example.com"');
    });
    await step("the preview follows the line and the logo", async () => {
      await expect(preview().innerHTML).toContain("border-top");
      await userEvent.click(canvas.getByRole("switch"));
      await expect(preview().innerHTML).not.toContain("border-top");
      await userEvent.click(canvas.getByRole("button", { name: "Remove logo" }));
      await expect(preview().querySelector("img")).toBeNull();
      await expect(new FormData(canvasElement.querySelector("form")!).get("logo_remove")).toBe("1");
    });
  },
};
