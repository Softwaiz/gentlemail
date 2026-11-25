"use client";

import { $generateHtmlFromNodes } from "@lexical/html";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { FormError } from "@/app/components/action-form";
import { RichEditor } from "@/app/components/rich-editor";
import { Field } from "@/app/components/section";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Slider } from "@/app/components/ui/slider";
import { Switch } from "@/app/components/ui/switch";
import { LOGO_DEFAULT, LOGO_MAX, LOGO_MIN, type LogoPosition, type SignatureLook, signatureBlock } from "@/lib/signature-html";
import { textToHtml } from "@/lib/util";
import { t } from "@lingui/core/macro";

type Image = { src: string; ratio: number };

/**
 * A mailbox's signature, inside its settings form: text, logo, line, and how it will look.
 * Read on the server by readSignature (lib/signature.ts), which checks everything again.
 */
export function SignatureFields({ look }: { look: SignatureLook }) {
  const saved = look.logo;
  const [html, setHtml] = useState(look.html);
  const [written, setWritten] = useState(!!look.text);
  const [line, setLine] = useState(look.line);
  const [picked, setPicked] = useState<Image | null>(null);
  const [removed, setRemoved] = useState(false);
  const [width, setWidth] = useState(saved?.width ?? LOGO_DEFAULT);
  const [position, setPosition] = useState<LogoPosition>(saved?.position ?? "left");
  const [link, setLink] = useState(saved?.link ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const widthLabel = useId();

  // Saved: the page comes back with the new logo (or none), so there is nothing left to send.
  const [src, setSrc] = useState(saved?.src);
  if (src !== saved?.src) {
    setSrc(saved?.src);
    setPicked(null);
    setRemoved(false);
  }
  useEffect(() => {
    if (file.current) file.current.value = "";
  }, [saved?.src]);

  const image: Image | null = picked ?? (removed ? null : saved);
  const shown: SignatureLook = {
    html: written ? html : "",
    text: written ? look.text : "",
    line,
    logo: image && { ...image, width, position, link: "", alt: saved?.alt ?? "" },
  };
  const preview = signatureBlock(shown);

  const forget = () => {
    if (file.current) file.current.value = "";
    setPicked(null);
  };
  const pick = async (chosen: File | undefined) => {
    setProblem(null);
    if (!chosen) return forget();
    const refuse = (why: string) => {
      forget();
      setProblem(why);
    };
    const wrongType = t({ id: "errors.logo_type", message: "Use a PNG, JPEG or GIF image for the logo." });
    if (!/^image\/(png|jpeg|gif)$/.test(chosen.type)) return refuse(wrongType);
    if (chosen.size > 200 * 1024) return refuse(t({ id: "errors.logo_size", message: "The logo can be at most 200 KB." }));
    const read = await readImage(chosen);
    if (!read) return refuse(wrongType);
    setPicked(read);
    setRemoved(false);
  };

  return (
    <div className="grid gap-5">
      <input type="hidden" name="signature_fields" value="1" />
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">{t({ id: "signature.label", message: "Signature" })}</span>
        <div className="overflow-hidden rounded-md border bg-background focus-within:border-ring">
          <RichEditor
            name="signature_html"
            label={t({ id: "signature.label", message: "Signature" })}
            placeholder={t({ id: "signature.placeholder", message: "Your name, what you do, your website…" })}
            initialHtml={look.html || (look.text ? textToHtml(look.text) : "")}
            bodyClassName="min-h-32"
          >
            <OnWritten
              then={(written, html) => {
                setWritten(written);
                setHtml(html);
              }}
            />
          </RichEditor>
        </div>
        <span className="text-xs text-muted-foreground">
          {t({ id: "signature.hint", message: "Added below new messages, replies and forwards, logo included. You can leave it out of any single message." })}
        </span>
      </div>

      <div className="grid gap-3">
        <span className="text-sm font-medium">{t({ id: "signature.logo", message: "Logo" })}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => file.current?.click()}>
            <ImagePlus /> {image ? t({ id: "signature.logo_replace", message: "Replace logo" }) : t({ id: "signature.logo_add", message: "Add logo" })}
          </Button>
          {image && (
            <Button
              type="button"
              variant="ghost-destructive"
              size="sm"
              onClick={() => {
                forget();
                setProblem(null);
                setRemoved(true);
              }}
            >
              <Trash2 /> {t({ id: "signature.logo_remove", message: "Remove logo" })}
            </Button>
          )}
          <span className="text-xs text-muted-foreground">{t({ id: "signature.logo_hint", message: "PNG, JPEG or GIF, up to 200 KB" })}</span>
          <input
            ref={file}
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/gif"
            aria-label={t({ id: "signature.logo", message: "Logo" })}
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          {removed && <input type="hidden" name="logo_remove" value="1" />}
        </div>
        <FormError error={problem} />
        {image && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-1.5 text-sm font-medium">
              <span id={widthLabel}>{t({ id: "signature.logo_width", message: `Width: ${width} px` })}</span>
              <Slider
                name="logo_width"
                aria-labelledby={widthLabel}
                min={LOGO_MIN}
                max={LOGO_MAX}
                value={[width]}
                onValueChange={([w]) => setWidth(w)}
                className="h-9"
              />
            </div>
            <fieldset className="grid content-start gap-1.5 text-sm">
              <legend className="mb-1.5 font-medium">{t({ id: "signature.logo_position", message: "Position" })}</legend>
              <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1">
                {(["left", "above"] as const).map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <input type="radio" name="logo_position" value={p} checked={position === p} onChange={() => setPosition(p)} className="accent-primary" />
                    {p === "left" ? t({ id: "signature.logo_left", message: "Left of the text" }) : t({ id: "signature.logo_above", message: "Above the text" })}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="sm:col-span-2">
              <Field label={t({ id: "signature.logo_link", message: "Logo link (optional)" })}>
                <Input name="logo_link" value={link} onChange={(e) => setLink(e.target.value)} placeholder={"https://example.com"} inputMode="url" autoComplete="off" />
              </Field>
            </div>
          </div>
        )}
      </div>

      <label className="flex items-center gap-3 text-sm">
        <Switch name="signature_line" checked={line} onCheckedChange={setLine} />
        <span>
          <span className="font-medium">{t({ id: "signature.line", message: "Line above the signature" })}</span>
          <span className="block text-muted-foreground">{t({ id: "signature.line_hint", message: "A thin line between your message and the signature." })}</span>
        </span>
      </label>

      <div className="text-sm">
        <div className="text-xs font-medium text-muted-foreground">{t({ id: "settings.preview", message: "How it looks" })}</div>
        <div className="mt-2 overflow-x-auto rounded-md border bg-background p-4">
          <div className="mb-5 text-muted-foreground">{t({ id: "settings.preview_message", message: "…your message" })}</div>
          {preview ? (
            <div className="signature-view" dangerouslySetInnerHTML={{ __html: preview }} />
          ) : (
            <div className="text-muted-foreground">{t({ id: "settings.no_signature", message: "No signature yet" })}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Calls back with whether anything is written, and its HTML, on every change. */
function OnWritten({ then }: { then: (written: boolean, html: string) => void }) {
  const [editor] = useLexicalComposerContext();
  const latest = useRef(then);
  latest.current = then;
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
        if (!dirtyElements.size && !dirtyLeaves.size) return;
        editorState.read(() => latest.current(!!$getRoot().getTextContent().trim(), $generateHtmlFromNodes(editor, null)), { editor });
      }),
    [editor],
  );
  return null;
}

/** The image as a data: address (the page's security policy allows no blob:) and its proportions. */
async function readImage(file: File): Promise<Image | null> {
  try {
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const img = new window.Image();
    img.src = src;
    await img.decode();
    return img.naturalWidth && img.naturalHeight ? { src, ratio: img.naturalHeight / img.naturalWidth } : null;
  } catch {
    return null;
  }
}
