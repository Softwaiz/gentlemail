import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

/** A grey square as the picture: no request leaves Storybook. */
const PICTURE =
  "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#8155f6"/><circle cx="20" cy="16" r="7" fill="#f5f5f0"/><rect x="8" y="26" width="24" height="14" rx="7" fill="#f5f5f0"/></svg>');

const meta = {
  title: "Foundations/Avatar",
  component: Avatar,
  parameters: { layout: "centered" },
  argTypes: { size: { control: "inline-radio", options: ["sm", "default", "lg"] } },
} satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Initials: Story = { render: (args) => <Avatar {...args}><AvatarFallback>AL</AvatarFallback></Avatar> };
export const WithPicture: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage src={PICTURE} alt="Ada Lovelace" />
      <AvatarFallback>AL</AvatarFallback>
    </Avatar>
  ),
};
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {(["sm", "default", "lg"] as const).map((s) => <Avatar key={s} size={s}><AvatarFallback>GH</AvatarFallback></Avatar>)}
    </div>
  ),
};
