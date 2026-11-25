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

/** Having written in the signature, the link and the width are changed without the signature taking the focus back. */
export const EditingTheLogo: Story = {
  ...WithLogo,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const preview = () => canvasElement.querySelector<HTMLElement>(".signature-view")!;
    const posted = (name: string) => new FormData(canvasElement.querySelector("form")!).get(name);
    const signature = await canvas.findByRole("textbox", { name: "Signature" });
    await waitFor(() => expect(signature).toHaveTextContent("Anna Example"));
    await userEvent.click(signature);
    await step("the whole link goes in its field", async () => {
      const link = canvas.getByRole("textbox", { name: /^Logo link/ });
      await userEvent.clear(link);
      await userEvent.type(link, "https://example.org/shop", { delay: 20 });
      await expect(link).toHaveFocus();
      await expect(posted("logo_link")).toBe("https://example.org/shop");
      await expect(signature).not.toHaveTextContent("shop");
    });
    await step("a click on the bar sets the width, and the preview follows", async () => {
      const track = canvasElement.querySelector<HTMLElement>("[data-slot=slider-track]")!;
      const { left, width, top, height } = track.getBoundingClientRect();
      await userEvent.pointer({ keys: "[MouseLeft]", target: track, coords: { clientX: left + width * 0.9, clientY: top + height / 2 } });
      await expect(Number(posted("logo_width"))).toBeGreaterThan(250);
      await expect(preview().querySelector("img")).toHaveAttribute("width", String(posted("logo_width")));
      await expect(canvas.getByRole("slider", { name: /^Width/ })).toHaveFocus();
    });
    await step("and moved with the arrow keys", async () => {
      const before = Number(posted("logo_width"));
      await userEvent.keyboard("{ArrowLeft}");
      await expect(posted("logo_width")).toBe(String(before - 1));
    });
  },
};
