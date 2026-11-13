// Small stroke icons (24×24 grid, currentColor). Kept inline so pages need no icon font.
const paths = {
  compose: "M4 20h4L19 9l-4-4L4 16v4z M13.5 6.5l4 4",
  inbox: "M3 13h5l1.5 3h5L16 13h5 M5.5 5h13L21 13v6H3v-6z",
  sent: "M21 3 10 14 M21 3l-7 18-4-7-7-4z",
  archive: "M3 4h18v4H3z M5 8v12h14V8 M10 12h4",
  spam: "M12 3 2 20h20z M12 10v4 M12 17h.01",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  signature: "M3 17c3-1 5-7 7-7s-1 7 1 7 3-4 5-4 1 4 5 4 M3 21h18",
  admin: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z",
  logout: "M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10",
  clip: "M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L15.5 7.5",
  reply: "M9 14 4 9l5-5 M4 9h10a6 6 0 0 1 6 6v5",
  replyAll: "M7 14 2 9l5-5 M12 14 7 9l5-5 M7 9h7a6 6 0 0 1 6 6v5",
  forward: "M15 14l5-5-5-5 M20 9H10a6 6 0 0 0-6 6v5",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  download: "M12 4v11 M7 10l5 5 5-5 M5 20h14",
  back: "M15 18l-6-6 6-6",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4",
  mailbox: "M4 6h16v12H4z M4 7l8 6 8-6",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
