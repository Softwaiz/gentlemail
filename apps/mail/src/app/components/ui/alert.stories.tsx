import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleAlert, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./alert";

const meta = {
  title: "Foundations/Alert",
  component: Alert,
  parameters: { layout: "padded" },
  argTypes: { variant: { control: "inline-radio", options: ["default", "destructive"] } },
} satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InfoAlert: Story = {
  render: (args) => (
    <Alert {...args} className="max-w-lg">
      <Info />
      <AlertTitle>DNS records not found yet</AlertTitle>
      <AlertDescription>Changes can take up to an hour to show. Check again later.</AlertDescription>
    </Alert>
  ),
};
export const Error: Story = { ...InfoAlert, args: { variant: "destructive" } };
export const LongText: Story = {
  render: (args) => (
    <Alert {...args} variant="destructive" className="max-w-lg">
      <CircleAlert />
      <AlertTitle>This mailbox is turned off, so it can't send or receive mail until an admin turns it on again</AlertTitle>
      <AlertDescription>
        Mail sent to it while it's off is bounced to the sender with a message saying the address doesn't accept mail. Nothing
        already in it is deleted, and you can still read and organize what's there. Ask an admin in Admin → Mailboxes.
      </AlertDescription>
    </Alert>
  ),
};
