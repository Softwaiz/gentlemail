import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";
import { Input } from "./input";

const meta = {
  title: "Foundations/Dialog",
  component: Dialog,
  args: { defaultOpen: true },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger asChild><Button variant="outline">Rename mailbox</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename mailbox</DialogTitle>
          <DialogDescription>The name shows next to the address when you send.</DialogDescription>
        </DialogHeader>
        <Input defaultValue="Acme support" />
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const Closed: Story = { ...Open, args: { defaultOpen: false } };

export const LongBody: Story = {
  render: (args) => (
    <Dialog {...args}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What this key can do</DialogTitle>
          <DialogDescription>Each mailbox it can reach, and what it may do there.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[50vh] gap-2 overflow-y-auto text-sm">
          {Array.from({ length: 30 }, (_, n) => (
            <div key={n} className="flex justify-between border-b py-1.5">
              <span>mailbox-{n + 1}@alpha.test</span>
              <span className="text-muted-foreground">Read, Organize</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  ),
};

export const OnPhone: Story = { ...Open, globals: { viewport: { value: "phone" } } };
