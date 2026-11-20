"use client";

import { $generateHtmlFromNodes } from "@lexical/html";
import { $createLinkNode, $isAutoLinkNode, $isLinkNode, $toggleLink, AutoLinkNode, LinkNode } from "@lexical/link";
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
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type BaseSelection,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  type LexicalCommand,
  type NodeKey,
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
  Pencil,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Unlink,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

/**
 * What a link may point to: a web address on a real domain name ("https://+336…" is not
 * one) or an email address. The server allows the same schemes.
 */
function validUrl(url: string) {
  if (/^mailto:[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/i.test(url)) return true;
  if (!/^https?:\/\/[^\s"<>]+$/i.test(url)) return false;
  try {
    // URL gives non-ASCII names as punycode, so the last label can be "xn--p1ai".
    return /^([a-z0-9-]+\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

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
  const area = useRef<HTMLDivElement>(null);
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
      <div ref={area} className="relative">
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
        <LinkCard area={area} />
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

/** Opens the link card on the selection: the toolbar's link button and Ctrl/⌘ K. */
const OPEN_LINK_EDITOR: LexicalCommand<void> = createCommand("OPEN_LINK_EDITOR");

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

  useEffect(() => setMod(/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+"), []);

  const format = useCallback((f: TextFormatType) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, f), [editor]);
  const openLink = useCallback(() => editor.dispatchCommand(OPEN_LINK_EDITOR, undefined), [editor]);

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
              // With Shift: Ctrl/⌘ , alone opens the browser's settings.
              : e.shiftKey && e.code === "Comma" ? () => format("subscript")
              : e.shiftKey && e.code === "Period" ? () => format("superscript")
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

  const toggleQuote = () =>
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) $setBlocksType(selection, () => (formats.quote ? $createParagraphNode() : $createQuoteNode()));
    });

  const clear = () =>
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      // extract() splits the text at the selection's edges: only the selected words change.
      if (!selection.isCollapsed()) for (const node of selection.extract()) if ($isTextNode(node)) node.setFormat(0);
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
      { icon: Subscript, label: "Subscript", keys: `${mod}Shift+,`, active: formats.subscript, run: () => format("subscript") },
      { icon: Superscript, label: "Superscript", keys: `${mod}Shift+.`, active: formats.superscript, run: () => format("superscript") },
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
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-x-0.5 gap-y-1 border-b px-3 py-1.5">
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
                "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                active && "bg-accent text-foreground",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

type LinkRef = { key: NodeKey; url: string };

/** The link a DOM element sits in, if any. Call inside editor.read. */
function $linkAt(dom: Node | null): LinkRef | null {
  const node = dom ? $getNearestNodeFromDOMNode(dom) : null;
  const link = $isLinkNode(node) ? node : node ? $findMatchingParent(node, $isLinkNode) : null;
  return $isLinkNode(link) ? { key: link.getKey(), url: link.getURL() } : null;
}

const shownUrl = (url: string) => url.replace(/^mailto:/i, "");

/*
 * The card that floats by a link. Hovering a link, or putting the cursor in one, shows
 * its address with Open, Edit and Remove. The link button and Ctrl/⌘ K open it as a
 * form on the selected text; with nothing selected, the address itself is inserted.
 */
function LinkCard({ area }: { area: React.RefObject<HTMLDivElement | null> }) {
  const [editor] = useLexicalComposerContext();
  const [caret, setCaret] = useState<LinkRef | null>(null);
  const [hover, setHover] = useState<LinkRef | null>(null);
  const [focused, setFocused] = useState(false);
  const [edit, setEdit] = useState<{ key: NodeKey | null; draft: string; rect: DOMRect | null; invalid?: boolean } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [, setTick] = useState(0);
  const saved = useRef<BaseSelection | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const view = edit ? null : (hover ?? (focused ? caret : null));
  const open = !!(edit || view);

  const keepHover = () => clearTimeout(hideTimer.current);
  const dropHover = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHover(null), 250);
  };

  const startEdit = useCallback(() => {
    editor.read(() => {
      const selection = $getSelection();
      saved.current = selection?.clone() ?? null;
      let link: LinkRef | null = null;
      if ($isRangeSelection(selection)) {
        const node = $findMatchingParent(selection.anchor.getNode(), $isLinkNode);
        if ($isLinkNode(node)) link = { key: node.getKey(), url: node.getURL() };
      }
      const dom = window.getSelection();
      const r = dom?.rangeCount ? dom.getRangeAt(0).getBoundingClientRect() : null;
      setHover(null);
      setEdit({ key: link?.key ?? null, draft: link ? shownUrl(link.url) : "", rect: r && (r.width || r.height) ? r : null });
    });
    return true;
  }, [editor]);

  useEffect(() => {
    // Made once per effect, so the root listener below removes the same functions it added.
    const over = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      keepHover();
      editor.read(() => setHover($linkAt(a)));
    };
    const out = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a");
      if (a && !(e.relatedTarget instanceof Node && a.contains(e.relatedTarget))) dropHover();
    };
    const focus = () => setFocused(true);
    const blur = () => setFocused(false);
    return mergeRegister(
      editor.registerCommand(OPEN_LINK_EDITOR, startEdit, COMMAND_PRIORITY_NORMAL),
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          let link: LinkRef | null = null;
          if ($isRangeSelection(selection)) {
            const a = $findMatchingParent(selection.anchor.getNode(), $isLinkNode);
            const b = $findMatchingParent(selection.focus.getNode(), $isLinkNode);
            if ($isLinkNode(a) && a.is(b)) link = { key: a.getKey(), url: a.getURL() };
          }
          setCaret((c) => (c?.key === link?.key && c?.url === link?.url ? c : link));
          setHover((h) => (h && !$getNodeByKey(h.key) ? null : h));
        });
        setTick((t) => t + 1); // the text moved: place the card again
      }),
      editor.registerRootListener((root, prev) => {
        prev?.removeEventListener("mouseover", over);
        prev?.removeEventListener("mouseout", out);
        prev?.removeEventListener("focus", focus);
        prev?.removeEventListener("blur", blur);
        root?.addEventListener("mouseover", over);
        root?.addEventListener("mouseout", out);
        root?.addEventListener("focus", focus);
        root?.addEventListener("blur", blur);
      }),
    );
  }, [editor, startEdit]);

  // Editing: focus the address; a click anywhere else closes the card.
  const editing = !!edit;
  const placed = !!pos;
  useEffect(() => {
    if (editing && placed) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing, placed]);
  useEffect(() => {
    if (!editing) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setEdit(null);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [editing]);

  useEffect(() => {
    if (!open) return;
    const again = () => setTick((t) => t + 1);
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, [open]);

  // Under the link (above it when there's no room below), kept inside the editor's width.
  useLayoutEffect(() => {
    const wrap = area.current;
    const card = box.current;
    if (!wrap || !card) {
      if (pos) setPos(null);
      return;
    }
    const key = edit ? edit.key : view?.key;
    const target = (key ? editor.getElementByKey(key)?.getBoundingClientRect() : null) ?? edit?.rect ?? null;
    const w = wrap.getBoundingClientRect();
    const r = target ?? new DOMRect(w.left + 20, w.top + 16, 0, 20);
    const h = card.offsetHeight;
    let top = r.bottom - w.top + 6;
    if (r.bottom + 6 + h > w.bottom + 40 && r.top - w.top - h - 6 >= 0) top = r.top - w.top - h - 6;
    const left = Math.round(Math.max(8, Math.min(r.left - w.left, w.width - card.offsetWidth - 8)));
    top = Math.round(top);
    if (!pos || pos.top !== top || pos.left !== left) setPos({ top, left });
  });

  if (!open) return null;

  const close = () => {
    setEdit(null);
    setHover(null);
    editor.focus();
  };

  const removeLink = (key: NodeKey) => {
    editor.update(() => {
      const node = $getNodeByKey(key);
      if ($isAutoLinkNode(node)) {
        // Typed addresses would link themselves again: mark this one as unlinked.
        node.setIsUnlinked(true);
      } else if ($isLinkNode(node)) {
        for (const child of node.getChildren()) node.insertBefore(child);
        node.remove();
      }
    });
    close();
  };

  const apply = () => {
    if (!edit) return;
    if (!edit.draft.trim()) return edit.key ? removeLink(edit.key) : close();
    const url = normalizeUrl(edit.draft);
    if (!validUrl(url)) {
      setEdit({ ...edit, invalid: true });
      return;
    }
    editor.update(() => {
      if (edit.key) {
        const node = $getNodeByKey(edit.key);
        // A typed address keeps following its text; an edited one becomes a plain link.
        if ($isAutoLinkNode(node)) node.replace($createLinkNode(url), true);
        else if ($isLinkNode(node)) node.setURL(url);
        return;
      }
      const selection = saved.current?.clone();
      if (!$isRangeSelection(selection)) return;
      $setSelection(selection);
      if (selection.isCollapsed()) selection.insertNodes([$createLinkNode(url).append($createTextNode(shownUrl(url)))]);
      else $toggleLink(url);
    });
    close();
  };

  const button = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";
  return (
    <div
      ref={box}
      role={edit ? "dialog" : undefined}
      aria-label={edit ? (edit.key ? "Edit link" : "Add link") : undefined}
      onMouseEnter={keepHover}
      onMouseLeave={() => hover && dropHover()}
      // Keep the cursor in the text when clicking the card's buttons.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      // Until it is placed: invisible, but still focusable.
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, opacity: 0, pointerEvents: "none" }}
      className="composer-card absolute z-20 flex w-max max-w-[min(26rem,calc(100%-1rem))] items-center gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      {edit ? (
        <>
          <input
            ref={input}
            value={edit.draft}
            onChange={(e) => setEdit({ ...edit, draft: e.target.value, invalid: false })}
            onKeyDown={(e) => {
              // Enter must not send the message.
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            placeholder="https://… or name@example.com"
            aria-label="Link address"
            aria-invalid={edit.invalid || undefined}
            className={cn(
              "h-7 w-64 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              edit.invalid && "border-destructive focus-visible:ring-destructive/40",
            )}
          />
          <button type="button" onClick={apply} className={cn(button, "bg-primary text-primary-foreground hover:opacity-90")}>
            {edit.key ? "Save" : "Add"}
          </button>
          {edit.key && (
            <button type="button" onClick={() => removeLink(edit.key!)} title="Remove link" aria-label="Remove link" className={cn(button, "px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground")}>
              <Unlink className="size-3.5" />
            </button>
          )}
        </>
      ) : (
        view && (
          <>
            <a
              href={view.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${shownUrl(view.url)}`}
              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <LinkIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate underline underline-offset-2">{shownUrl(view.url)}</span>
            </a>
            <span className="mx-0.5 h-5 border-l" aria-hidden />
            <button
              type="button"
              onClick={() => {
                saved.current = null;
                setHover(null);
                setEdit({ key: view.key, draft: shownUrl(view.url), rect: null });
              }}
              title="Edit link"
              aria-label="Edit link"
              className={cn(button, "px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => removeLink(view.key)}
              title="Remove link"
              aria-label="Remove link"
              className={cn(button, "px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              <Unlink className="size-3.5" />
            </button>
          </>
        )
      )}
    </div>
  );
}
