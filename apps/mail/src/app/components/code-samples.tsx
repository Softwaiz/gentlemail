"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type Flavor = "sdk" | "http";

export type Sample = {
  title: string;
  sdk: string;
  http: string;
  sdkNote?: React.ReactNode;
  httpNote?: React.ReactNode;
};

const STORAGE_KEY = "quick-reference";

export const Code = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-md bg-sidebar px-4 py-3 font-mono text-[12.5px] leading-relaxed text-sidebar-foreground">{children}</pre>
);

/*
 * The Quick reference on API & webhooks: the same examples with the JavaScript SDK or over
 * HTTP. One switch changes them all; the choice is remembered in this browser.
 */
export function CodeSamples({
  samples,
  intro,
}: {
  samples: Sample[];
  /** What to read before the samples: how to install the SDK, or the base URL and auth. */
  intro: Record<Flavor, React.ReactNode>;
}) {
  const [flavor, setFlavor] = useState<Flavor>("sdk");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "sdk" || saved === "http") setFlavor(saved);
    } catch {}
  }, []);

  const choose = (f: Flavor) => {
    setFlavor(f);
    try {
      localStorage.setItem(STORAGE_KEY, f);
    } catch {}
  };

  const options: { id: Flavor; label: string }[] = [
    { id: "sdk", label: "JavaScript SDK" },
    { id: "http", label: "HTTP" },
  ];

  return (
    <div className="grid gap-5 text-sm *:min-w-0">
      <div className="grid gap-3">
        <div role="group" aria-label="Show examples for" className="inline-flex w-fit rounded-md border bg-muted/40 p-0.5">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={flavor === o.id}
              onClick={() => choose(o.id)}
              className={cn(
                "rounded-[5px] px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
                flavor === o.id && "bg-background text-foreground shadow-sm",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="text-muted-foreground">{intro[flavor]}</div>
      </div>

      {samples.map((s) => {
        const note = flavor === "sdk" ? s.sdkNote : s.httpNote;
        return (
          <div key={s.title}>
            <div className="mb-2 font-medium">{s.title}</div>
            <Code>{flavor === "sdk" ? s.sdk : s.http}</Code>
            {note && <p className="mt-2 text-muted-foreground">{note}</p>}
          </div>
        );
      })}
    </div>
  );
}
