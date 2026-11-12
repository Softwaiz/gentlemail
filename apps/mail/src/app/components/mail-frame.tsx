"use client";

import { useEffect, useRef } from "react";

/** Sandboxed iframe for untrusted HTML mail; grows to fit its content. */
export function MailFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const fit = () => {
    const el = ref.current;
    const doc = el?.contentDocument;
    if (el && doc) el.style.height = `${Math.max(doc.documentElement.scrollHeight, 80) + 8}px`;
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
      className="mail-frame"
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
