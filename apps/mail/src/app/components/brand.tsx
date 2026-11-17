import { env } from "cloudflare:workers";
import { cn } from "@/lib/utils";
import markSvg from "@/app/assets/mark.svg?raw";
import wordmarkSvg from "@/app/assets/wordmark.svg?raw";

export const appName = () => env.APP_NAME || "Mail";

/** The GentleMail logo is used only under that name; an instance renamed with APP_NAME shows its own name as text. */
export const hasLogo = () => appName() === "GentleMail";

// The wordmark's letters follow the text colour; its dot stays lime.
const wordmarkHtml = wordmarkSvg
  .replaceAll('fill="#f5f5f0"', 'fill="currentColor"')
  .replace("<svg ", '<svg aria-hidden="true" width="100%" height="100%" ');
const markHtml = markSvg.replace("<svg ", '<svg aria-hidden="true" width="100%" height="100%" ');

/** The "g." mark, also the favicon: ink tile, paper g, lime dot. Under another APP_NAME: its first letter. */
export function LogoMark({ className }: { className?: string }) {
  if (!hasLogo())
    return (
      <span
        aria-hidden="true"
        className={cn("grid size-7 shrink-0 place-items-center rounded-[22%] bg-[#080b10] font-bold text-[#f5f5f0]", className)}
      >
        <span>
          {appName().slice(0, 1).toLowerCase()}
          <span className="text-lime">.</span>
        </span>
      </span>
    );
  return <span className={cn("block size-7 shrink-0", className)} dangerouslySetInnerHTML={{ __html: markHtml }} />;
}

/** "gentlemail." as on gentlemail.dev, sized by its height. Under another APP_NAME: that name with a lime dot, as text. */
export function Wordmark({ className }: { className?: string }) {
  if (!hasLogo())
    return (
      <span className={cn("leading-none font-bold tracking-[-0.04em]", className)}>
        {appName()}
        <span className="text-lime">.</span>
      </span>
    );
  return (
    <span role="img" aria-label={appName()} className={cn("block aspect-[404.68/88.308] h-[1.15em]", className)}>
      <span className="block size-full" dangerouslySetInnerHTML={{ __html: wordmarkHtml }} />
    </span>
  );
}
