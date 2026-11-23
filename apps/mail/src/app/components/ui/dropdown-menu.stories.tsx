import type { Meta, StoryObj } from "@storybook/react-vite";
import { KeyRound, LogOut, Moon } from "lucide-react";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

const meta = {
  title: "Foundations/Dropdown menu",
  component: DropdownMenu,
  args: { defaultOpen: true, modal: false },
  parameters: { layout: "centered" },
} satisfies Meta<typeof DropdownMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

const Items = () => (
  <DropdownMenuContent className="w-56">
    <DropdownMenuLabel>ada@alpha.test</DropdownMenuLabel>
    <DropdownMenuItem><KeyRound /> Security</DropdownMenuItem>
    <DropdownMenuItem disabled><Moon /> Theme (disabled)</DropdownMenuItem>
    <DropdownMenuRadioGroup value="dark">
      <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive"><LogOut /> Sign out</DropdownMenuItem>
  </DropdownMenuContent>
);

export const Open: Story = {
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild><Button variant="outline">Account</Button></DropdownMenuTrigger>
      <Items />
    </DropdownMenu>
  ),
};

/** Opened from the bottom right corner: the menu turns to stay on screen. */
export const NearTheEdge: Story = {
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <div className="flex h-screen items-end justify-end p-2">
      <DropdownMenu {...args}>
        <DropdownMenuTrigger asChild><Button variant="outline">Account</Button></DropdownMenuTrigger>
        <Items />
      </DropdownMenu>
    </div>
  ),
};
