// What the <Trans> macro renders (lingui.config.ts): Lingui's own Trans, given our i18n object
// directly instead of reading it from React context, which server components don't have.
import type { TransProps } from "@lingui/react";
import { TransNoContext } from "@lingui/react/server";
import { i18n } from "@/lib/i18n";

export function Trans(props: TransProps) {
  return <TransNoContext {...props} lingui={{ i18n }} />;
}
