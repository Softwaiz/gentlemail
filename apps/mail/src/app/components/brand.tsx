import { env } from "cloudflare:workers";
import { cn } from "@/lib/utils";

export const appName = () => env.APP_NAME || "Mail";

/** Envelope mark: ink tile, paper envelope, lime flap. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-7 shrink-0", className)} aria-hidden="true">
      <rect width="64" height="64" rx="10" fill="#080b10" />
      <path d="M14 20h36v24H14z" fill="none" stroke="#f5f5f0" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M14 21l18 13 18-13" fill="none" stroke="#ebff01" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Wordmark in the Softwaiz manner: tight bold type, closing lime dot. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-bold tracking-[-0.04em] leading-none", className)}>
      {appName()}
      <span className="text-lime">.</span>
    </span>
  );
}
