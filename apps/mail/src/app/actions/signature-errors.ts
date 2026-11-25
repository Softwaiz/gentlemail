import type { SignatureProblem } from "@/lib/signature";
import { t } from "@lingui/core/macro";

/** Why a signature couldn't be saved, in the reader's language. */
export const signatureProblemText = (problem: SignatureProblem): string =>
  ({
    too_long: t({ id: "errors.signature_long", message: "This signature is too long." }),
    logo_type: t({ id: "errors.logo_type", message: "Use a PNG, JPEG or GIF image for the logo." }),
    logo_size: t({ id: "errors.logo_size", message: "The logo can be at most 200 KB." }),
    logo_link: t({ id: "errors.logo_link", message: "The logo's link must be a web address, like https://example.com." }),
  })[problem];
