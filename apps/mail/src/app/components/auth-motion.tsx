"use client";

import { MotionConfig, motion } from "motion/react";
import type * as React from "react";

/**
 * The sign-in card. When it comes back with an error, it gives a short shake so the
 * mistake is noticed. With reduced motion asked for, it stays still (MotionConfig "user"
 * drops movement). The card is visible either way: nothing here waits for JavaScript.
 */
export function ShakeCard({ error, className, children }: { error?: string | null; className?: string; children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        // A new error shakes again, even when it's the same message on a fresh page.
        key={error ?? "ok"}
        className={className}
        animate={error ? { x: [0, -7, 6, -4, 3, 0] } : undefined}
        transition={{ duration: 0.42, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}
