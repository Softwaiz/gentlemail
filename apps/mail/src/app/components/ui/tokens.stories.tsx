import type { Meta, StoryObj } from "@storybook/react-vite";

/* The design tokens from styles.css, drawn in both themes side by side. */

const COLOURS = [
  ["background", "foreground"], ["card", "card-foreground"], ["popover", "popover-foreground"],
  ["primary", "primary-foreground"], ["secondary", "secondary-foreground"], ["muted", "muted-foreground"],
  ["accent", "accent-foreground"], ["destructive"], ["border"], ["input"], ["ring"],
  ["lime", "lime-ink"], ["violet"], ["unread"],
  ["sidebar", "sidebar-foreground"], ["sidebar-muted"], ["sidebar-accent"], ["sidebar-border"],
];

function Swatches({ theme }: { theme: "light" | "dark" }) {
  return (
    <div data-theme={theme} style={{ colorScheme: theme }} className="bg-background p-6 text-foreground">
      <h2 className="mb-4 text-sm font-semibold capitalize">{theme}</h2>
      <div className="grid gap-2">
        {COLOURS.map(([bg, fg]) => (
          <div key={bg} className="flex items-center gap-3 text-[13px]">
            <span
              className="grid h-10 w-24 shrink-0 place-items-center rounded-md border text-xs font-semibold"
              style={{ background: `var(--${bg})`, color: fg ? `var(--${fg})` : undefined }}
            >
              {fg ? "Aa" : ""}
            </span>
            <code className="font-mono text-xs">--{bg}</code>
            {fg && <code className="font-mono text-xs text-muted-foreground">on --{fg}</code>}
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = { title: "Foundations/Tokens", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;

export const Colours: StoryObj = {
  render: () => (
    <div className="grid md:grid-cols-2">
      <Swatches theme="light" />
      <Swatches theme="dark" />
    </div>
  ),
};

/** The sizes the pages use, in Google Sans. */
export const Type: StoryObj = {
  render: () => (
    <div className="grid gap-4 bg-background p-8 text-foreground">
      <p className="text-[32px] leading-tight font-semibold tracking-[-0.02em]">32 · Error page title</p>
      <p className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">28 · Large title</p>
      <p className="text-2xl leading-tight font-semibold tracking-[-0.02em]">24 · Page title (PageHeader)</p>
      <p className="text-xl font-semibold tracking-[-0.02em]">20 · Card title (sign-in)</p>
      <p className="text-[15px]">15 · Lead text</p>
      <p className="text-sm">14 · Body</p>
      <p className="text-[13px] text-muted-foreground">13 · List and secondary text</p>
      <p className="text-xs text-muted-foreground">12 · Hints</p>
      <p className="font-mono text-sm">Mono · gm_live_3f9a… · abcde-23456</p>
    </div>
  ),
};

export const RadiusAndSpacing: StoryObj = {
  render: () => (
    <div className="grid gap-8 bg-background p-8 text-foreground">
      <div className="flex flex-wrap items-end gap-6">
        {/* Whole class names: Tailwind only builds the ones it can read, and doesn't write --radius-* as variables. */}
        {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"].map((r) => (
          <div key={r} className="grid justify-items-center gap-2 text-xs">
            <span className={`size-16 border-2 border-primary bg-muted ${r}`} />
            {r}
          </div>
        ))}
      </div>
      <div className="grid gap-2">
        {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
          <div key={n} className="flex items-center gap-3 text-xs">
            <code className="w-8 font-mono">{n}</code>
            <span className="h-3 bg-lime" style={{ width: `calc(var(--spacing) * ${n})` }} />
            <span className="text-muted-foreground">{n * 4}px</span>
          </div>
        ))}
      </div>
    </div>
  ),
};
