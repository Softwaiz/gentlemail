import type { Meta, StoryObj } from "@storybook/react-vite";
import { VerifyView } from "./auth-views";

/* The second step of signing in, from auth-views.tsx. The whole flow is in auth.stories.tsx. */

const meta = {
  title: "Screens/Two-step code",
  component: VerifyView,
  args: { email: "ada@example.com" },
} satisfies Meta<typeof VerifyView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoStepCode: Story = {};
export const WrongCode: Story = { args: { err: "That code didn't work. 4 tries left." } };
export const French: Story = { globals: { language: "fr" } };
export const LongEmail: Story = { args: { email: "someone.with.a.very.long.address@a-long-subdomain.example-company.com" } };
export const TwoStepOnPhone: Story = { globals: { viewport: { value: "phone" } } };
