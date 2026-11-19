"use client";

import { $generateHtmlFromNodes } from "@lexical/html";
import { $isLinkNode, AutoLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $isListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode, REMOVE_LIST_COMMAND } from "@lexical/list";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { AutoLinkPlugin, createLinkMatcherWithRegExp } from "@lexical/react/LexicalAutoLinkPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $createQuoteNode, $isQuoteNode, QuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $findMatchingParent, $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type BaseSelection,
  COMMAND_PRIORITY_NORMAL,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  type TextFormatType,
} from "lexical";
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  type LucideIcon,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Unlink,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * The composer's body: formatted text, posted as HTML in a hidden "html" field.
 * The server keeps only the formatting this toolbar can make (src/lib/compose-html.ts)
 * and writes the plain-text version from it.
 */

const THEME = {
  paragraph: "composer-p",
  quote: "composer-quote",
  link: "composer-link",
  list: { ul: "composer-ul", ol: "composer-ol", listitem: "composer-li", nested: { listitem: "composer-li-nested" } },
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    underlineStrikethrough: "[text-decoration:underline_line-through]",
    code: "composer-code",
  },
};

const URL_MATCHER = createLinkMatcherWithRegExp(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/i);
const EMAIL_MATCHER = createLinkMatcherWithRegExp(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, (text) => `mailto:${text}`);

/** What a link may point to, as the server also requires. */
const validUrl = (url: string) => /^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(url);

/** "example.com" → "https://example.com", "anna@example.com" → "mailto:anna@example.com". */
function normalizeUrl(input: string) {
  const v = input.trim();
  if (!v) return "";
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) return `mailto:${v}`;
  return `https://${v.replace(/^\/+/, "")}`;
}

export function RichEditor({ name = "html", placeholder = "Write your message…", autoFocus = false }: { name?: string; placeholder?: string; autoFocus?: boolean }) {
  const [html, setHtml] = useState("");
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "composer",
        theme: THEME,
        nodes: [ListNode, ListItemNode, QuoteNode, LinkNode, AutoLinkNode],
        onError: (e: Error) => console.error(e),
      }}
    >
      <Toolbar />
      <div className="relative">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Message"
              aria-multiline
              className="composer-body block min-h-72 w-full px-5 py-4 text-[15px] leading-relaxed outline-none"
            />
          }
          placeholder={<div className="pointer-events-none absolute top-4 left-5 text-[15px] text-muted-foreground select-none">{placeholder}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin validateUrl={validUrl} />
      <AutoLinkPlugin matchers={[URL_MATCHER, EMAIL_MATCHER]} />
      {autoFocus && <AutoFocusPlugin />}
      <OnChangePlugin ignoreSelectionChange onChange={(_state, editor) => editor.read(() => setHtml($generateHtmlFromNodes(editor, null)))} />
      <input type="hidden" name={name} value={html} />
    </LexicalComposer>
  );
}

type Formats = Record<"bold" | "italic" | "underline" | "strikethrough" | "subscript" | "superscript" | "code", boolean> & {
  link: string | null;
  list: "bullet" | "number" | null;
  quote: boolean;
};
const NO_FORMATS: Formats = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  subscript: false,
  superscript: false,
  code: false,
  link: null,
  list: null,
  quote: false,
};

function readFormats(): Formats {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return NO_FORMATS;
  const node = selection.anchor.getNode();
  const link = $findMatchingParent(node, $isLinkNode);
  const list = $getNearestNodeOfType(node, ListNode);
  const top = node.getKey() === "root" ? node : node.getTopLevelElementOrThrow();
  return {
    bold: selection.hasFormat("bold"),
    italic: selection.hasFormat("italic"),
    underline: selection.hasFormat("underline"),
    strikethrough: selection.hasFormat("strikethrough"),
    subscript: selection.hasFormat("subscript"),
    superscript: selection.hasFormat("superscript"),
    code: selection.hasFormat("code"),
    link: $isLinkNode(link) ? link.getURL() : null,
    list: $isListNode(list) ? (list.getListType() === "number" ? "number" : "bullet") : null,
    quote: $isQuoteNode(top),
  };
}

function Toolbar() {
  const [editor] = useLexicalComposerContext();
  const [formats, setFormats] = useState<Formats>(NO_FORMATS);
  const [mod, setMod] = useState("Ctrl+");
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const saved = useRef<BaseSelection | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);

  useEffect(() => setMod(/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+"), []);

  const format = useCallback((f: TextFormatType) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, f), [editor]);

  const openLink = useCallback(() => {
    editor.getEditorState().read(() => {
      saved.current = $getSelection()?.clone() ?? null;
      setLinkDraft(readFormats().link?.replace(/^mailto:/i, "") ?? "");
    });
  }, [editor]);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => editorState.read(() => setFormats(readFormats()))),
        // Shortcuts beyond the built-in bold, italic and underline.
        editor.registerCommand(
          KEY_DOWN_COMMAND,
          (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
            const key = e.key.toLowerCase();
            const action: (() => void) | undefined =
              e.shiftKey && key === "x" ? () => format("strikethrough")
              : !e.shiftKey && key === "," ? () => format("subscript")
              : !e.shiftKey && key === "." ? () => format("superscript")
              : !e.shiftKey && key === "e" ? () => format("code")
              : !e.shiftKey && key === "k" ? openLink
              : undefined;
            if (!action) return false;
            e.preventDefault();
            action();
            return true;
          },
          COMMAND_PRIORITY_NORMAL,
        ),
      ),
    [editor, format, openLink],
  );

  useEffect(() => {
    if (linkDraft !== null) linkInput.current?.focus();
  }, [linkDraft !== null]);

  const applyLink = (url: string | null) => {
    editor.update(() => {
      if (saved.current) $setSelection(saved.current.clone());
    });
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    setLinkDraft(null);
    editor.focus();
  };

  const toggleQuote = () =>
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) $setBlocksType(selection, () => (formats.quote ? $createParagraphNode() : $createQuoteNode()));
    });

  const clear = () =>
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      for (const node of selection.getNodes()) if ($isTextNode(node)) node.setFormat(0);
      selection.setFormat(0);
    });

  const list = (type: "bullet" | "number") =>
    editor.dispatchCommand(
      formats.list === type ? REMOVE_LIST_COMMAND : type === "bullet" ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
      undefined,
    );

  const groups: { icon: LucideIcon; label: string; keys?: string; active?: boolean; run: () => void }[][] = [
    [
      { icon: Bold, label: "Bold", keys: `${mod}B`, active: formats.bold, run: () => format("bold") },
      { icon: Italic, label: "Italic", keys: `${mod}I`, active: formats.italic, run: () => format("italic") },
      { icon: Underline, label: "Underline", keys: `${mod}U`, active: formats.underline, run: () => format("underline") },
      { icon: Strikethrough, label: "Strikethrough", keys: `${mod}Shift+X`, active: formats.strikethrough, run: () => format("strikethrough") },
    ],
    [
      { icon: Subscript, label: "Subscript", keys: `${mod},`, active: formats.subscript, run: () => format("subscript") },
      { icon: Superscript, label: "Superscript", keys: `${mod}.`, active: formats.superscript, run: () => format("superscript") },
    ],
    [
      { icon: LinkIcon, label: formats.link ? "Edit link" : "Add link", keys: `${mod}K`, active: !!formats.link, run: openLink },
      { icon: List, label: "Bulleted list", active: formats.list === "bullet", run: () => list("bullet") },
      { icon: ListOrdered, label: "Numbered list", active: formats.list === "number", run: () => list("number") },
      { icon: Quote, label: "Quote", active: formats.quote, run: toggleQuote },
      { icon: Code, label: "Code", keys: `${mod}E`, active: formats.code, run: () => format("code") },
    ],
    [{ icon: RemoveFormatting, label: "Clear formatting", run: clear }],
  ];

  return (
    <div className="border-b">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-x-0.5 gap-y-1 px-3 py-1.5">
        {groups.map((group, i) => (
          <div key={i} className={cn("flex shrink-0 items-center gap-0.5", i > 0 && "ml-1 border-l pl-1.5")}>
            {group.map(({ icon: Icon, label, keys, active, run }) => (
              <button
                key={label}
                type="button"
                title={keys ? `${label} (${keys})` : label}
                aria-label={label}
                aria-pressed={active === undefined ? undefined : active}
                // Keep the selection in the text while clicking.
                onMouseDown={(e) => e.preventDefault()}
                onClick={run}
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  active && "bg-accent text-foreground",
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        ))}
      </div>
      {linkDraft !== null && (
        <LinkRow
          inputRef={linkInput}
          value={linkDraft}
          onChange={setLinkDraft}
          hasLink={!!formats.link}
          onApply={() => {
            const url = normalizeUrl(linkDraft);
            applyLink(url && validUrl(url) ? url : null);
          }}
          onRemove={() => applyLink(null)}
          onCancel={() => {
            setLinkDraft(null);
            editor.focus();
          }}
        />
      )}
    </div>
  );
}

function LinkRow({
  inputRef,
  value,
  onChange,
  hasLink,
  onApply,
  onRemove,
  onCancel,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  hasLink: boolean;
  onApply: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const button = "h-8 shrink-0 rounded-md px-3 text-sm font-medium transition-colors";
  return (
    <div className="composer-link-row flex flex-wrap items-center gap-2 border-t bg-muted/40 px-3 py-2">
      <LinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter must not submit the whole message.
          if (e.key === "Enter") {
            e.preventDefault();
            onApply();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="https://… or name@example.com"
        aria-label="Link address"
        className="h-8 min-w-0 flex-1 basis-48 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <div className="flex gap-1">
        <button type="button" onClick={onApply} className={cn(button, "bg-primary text-primary-foreground hover:opacity-90")}>
          {hasLink ? "Update" : "Add link"}
        </button>
        {hasLink && (
          <button type="button" onClick={onRemove} className={cn(button, "inline-flex items-center gap-1.5 hover:bg-accent")}>
            <Unlink className="size-3.5" /> Remove
          </button>
        )}
        <button type="button" onClick={onCancel} className={cn(button, "text-muted-foreground hover:bg-accent hover:text-foreground")}>
          Cancel
        </button>
      </div>
    </div>
  );
}
