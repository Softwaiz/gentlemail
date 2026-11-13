"use client";

import { useEffect, useRef } from "react";

/** Sandboxed iframe for untrusted HTML mail; grows to fit its content. */
export function MailFrame({ src, title, adaptive }: { src: string; title: string; adaptive: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const fit = () => {
    const el = ref.current;
    const doc = el?.contentDocument;
    // Measure the body, not the document: the document is never shorter than the frame itself.
    if (el && doc?.body) el.style.height = `${Math.max(doc.body.scrollHeight + 8, 40) + (adaptive ? 0 : 16)}px`;
  };
  // The frame may finish loading before hydration, so also measure on mount.
  useEffect(() => {
    fit();
    const t = setTimeout(fit, 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <iframe
      ref={ref}
      src={src}
      title={title}
      className={
        adaptive
          ? "block min-h-10 w-full bg-transparent [color-scheme:light_dark]"
          : "block min-h-16 w-full rounded-md border bg-white px-3 py-2 [color-scheme:light]"
      }
      // Scripts never run. same-origin is only so we can measure the height.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      onLoad={() => {
        fit();
        setTimeout(fit, 400);
      }}
    />
  );
}
