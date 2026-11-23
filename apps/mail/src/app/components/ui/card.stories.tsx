import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
import { Separator } from "./separator";

const meta = { title: "Foundations/Card", component: Card, parameters: { layout: "padded" } } satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>alpha.test</CardTitle>
        <CardDescription>3 mailboxes · receiving and sending</CardDescription>
        <CardAction><Button variant="outline" size="sm">Open</Button></CardAction>
      </CardHeader>
      <CardContent className="text-sm">MX, SPF and DKIM records are in place.</CardContent>
      <Separator />
      <CardFooter className="text-xs text-muted-foreground">Checked 09:41</CardFooter>
    </Card>
  ),
};
export const LongTitle: Story = {
  render: () => (
    <Card className="max-w-xs">
      <CardHeader>
        <CardTitle className="break-words">customer-support-and-billing-questions.example-company.test</CardTitle>
        <CardDescription>No mailboxes yet</CardDescription>
      </CardHeader>
    </Card>
  ),
};
