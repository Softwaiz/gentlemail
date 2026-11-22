"use client";

import { Eye, EyeOff } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import * as React from "react";
import { Input } from "@/app/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/app/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A password field with a show/hide button on the right. The text is hidden again when the
 * form is sent, so password managers still see a password field. Without JavaScript it is
 * a plain password field.
 */
export function PasswordInput({
  className,
  what = "password",
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { /** What the field holds, for the button's label. */ what?: string }) {
  const [visible, setVisible] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const hide = () => {
      if (ref.current) ref.current.type = "password";
      setVisible(false);
    };
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, []);

  const toggle = () => {
    const input = ref.current;
    const focused = input && document.activeElement === input;
    const start = input?.selectionStart ?? null;
    const end = input?.selectionEnd ?? null;
    setVisible((v) => !v);
    // Keep the caret where it was when toggling while typing.
    if (focused) {
      requestAnimationFrame(() => {
        input.focus();
        if (start !== null && end !== null) input.setSelectionRange(start, end);
      });
    }
  };

  const label = `${visible ? "Hide" : "Show"} ${what}`;
  return (
    <div className="relative" data-visible={visible}>
      <Input ref={ref} type={visible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Show ${what}`}
              aria-pressed={visible}
              aria-controls={props.id}
              // Keeps focus in the field when clicked, so typing can go on.
              onMouseDown={(e) => document.activeElement === ref.current && e.preventDefault()}
              onClick={toggle}
              className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {/* The outgoing icon turns and shrinks away while the new one comes in. With
                  reduced motion asked for, only the fade is kept (MotionConfig "user"). */}
              <MotionConfig reducedMotion="user">
                <AnimatePresence initial={false}>
                  <motion.span
                    key={visible ? "hide" : "show"}
                    className="[grid-area:1/1]"
                    initial={{ opacity: 0, rotate: -60, scale: 0.5 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 60, scale: 0.5 }}
                    transition={{ type: "spring", duration: 0.3, bounce: 0.25 }}
                  >
                    {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  </motion.span>
                </AnimatePresence>
              </MotionConfig>
            </button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
