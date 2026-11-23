import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { MessageList } from "@/app/components/message-list";
import { LoginView, VerifyView } from "./auth-views";

/*
 * The sign-in screen, from auth-views.tsx: the same view the page renders, given made-up values. The
 * other screens there are in auth-verify.stories.tsx and auth-setup.stories.tsx, each with its own Controls.
 * In the app the forms post to the Worker; here nothing is sent (.storybook/fakes/browser.ts).
 */

const meta = {
  title: "Screens/Sign-in",
  component: LoginView,
  args: { next: "/" },
} satisfies Meta<typeof LoginView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {};

/** Submitting stays on the story: what was typed is never posted. */
export const NothingIsSent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const submitted: boolean[] = [];
    // Runs after the guard, which was added to window first.
    const seen = (e: Event) => submitted.push(e.defaultPrevented);
    window.addEventListener("submit", seen);
    try {
      await userEvent.type(canvas.getByLabelText("Email"), "ada@example.com");
      await userEvent.type(canvas.getByLabelText("Password"), "correct horse");
      await userEvent.click(canvas.getByRole("button", { name: "Sign in" }));
      await expect(submitted).toEqual([true]);
      await expect(canvas.getByLabelText("Email")).toHaveValue("ada@example.com");
    } finally {
      window.removeEventListener("submit", seen);
    }
  },
};

export const WrongPassword: Story = { args: { err: "Wrong email or password." } };
export const TimedOut: Story = { args: { err: "Your sign-in timed out. Enter your password again." } };
export const TooManyCodes: Story = { args: { err: "Too many wrong codes. Enter your password again." } };
export const SignInOnPhone: Story = { globals: { viewport: { value: "phone" } } };

/* ---------- The whole flow ---------- */

const PASSWORD = "correct horse";
const CODE = "123456";

/**
 * Sign-in → two-step code → inbox, with the Worker's answers played here: the password is
 * "correct horse" and the code 123456. Anything else shows the error the Worker would.
 */
function SignInFlow() {
  const [step, setStep] = useState<{ at: "login" | "verify" | "inbox"; err?: string; email?: string; tries?: number }>({ at: "login" });
  // Each answer is a new page in the app: count them, so the form starts empty again.
  const [page, setPage] = useState(0);

  const onSubmit = (e: React.FormEvent<HTMLDivElement>) => {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    setPage((n) => n + 1);
    if (step.at === "login") {
      const email = String(form.get("email"));
      if (form.get("password") !== PASSWORD) setStep({ at: "login", err: "Wrong email or password." });
      else setStep({ at: "verify", email, tries: 5 });
    } else if (step.at === "verify") {
      if (form.get("code") === CODE) setStep({ at: "inbox", email: step.email });
      else {
        const tries = (step.tries ?? 5) - 1;
        setStep(tries
          ? { ...step, tries, err: `That code didn't work. ${tries} ${tries === 1 ? "try" : "tries"} left.` }
          : { at: "login", err: "Too many wrong codes. Enter your password again." });
      }
    }
  };

  return (
    <div onSubmitCapture={onSubmit}>
      {step.at === "login" && <LoginView key={page} next="/" err={step.err} />}
      {step.at === "verify" && <VerifyView key={page} email={step.email!} err={step.err} />}
      {step.at === "inbox" && (
        <div className="flex min-h-screen flex-col bg-background text-foreground">
          <h1 className="px-6 py-4 text-lg font-semibold">Inbox</h1>
          <MessageList
            mailboxId="mb1"
            folder="inbox"
            scope="thread"
            items={[
              { key: "t1", threadId: "t1", folder: "inbox", who: "Grace Hopper", subject: "Welcome back", snippet: "You're signed in.", date: "09:41", unread: true, starred: false, attachments: false, count: 1 },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/** Plays by itself. Step through it, or stop at any screen, from the Interactions panel. */
export const Flow: StoryObj = {
  render: () => <SignInFlow />,
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step("Sign in with a wrong password", async () => {
      await userEvent.type(canvas.getByLabelText("Email"), "ada@example.com");
      await userEvent.type(canvas.getByLabelText("Password"), "guess");
      await userEvent.click(canvas.getByRole("button", { name: "Sign in" }));
      await expect(await canvas.findByRole("alert")).toHaveTextContent("Wrong email or password.");
    });
    await step("Sign in with the right one", async () => {
      await userEvent.type(canvas.getByLabelText("Email"), "ada@example.com");
      await userEvent.type(canvas.getByLabelText("Password"), PASSWORD);
      await userEvent.click(canvas.getByRole("button", { name: "Sign in" }));
      await expect(await canvas.findByText("Two-step verification")).toBeVisible();
    });
    await step("Type a wrong code", async () => {
      await userEvent.type(canvas.getByLabelText("Code"), "000000");
      await userEvent.click(canvas.getByRole("button", { name: "Verify" }));
      await expect(await canvas.findByRole("alert")).toHaveTextContent("4 tries left");
    });
    await step("Type the right code", async () => {
      await userEvent.type(canvas.getByLabelText("Code"), CODE);
      await userEvent.click(canvas.getByRole("button", { name: "Verify" }));
      await expect(await canvas.findByText("Welcome back")).toBeVisible();
    });
  },
};
