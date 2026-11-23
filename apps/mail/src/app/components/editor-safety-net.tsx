"use client";

import { $isListNode } from "@lexical/list";
import { $getRoot, type LexicalEditor } from "lexical";
import { Component, type ReactNode, type RefObject } from "react";
import { t } from "@lingui/core/macro";

/**
 * Catches an error thrown while the editor is drawn, which would otherwise take the whole page
 * down. The text written so far goes on in a plain field, posted as "body": without the editor's
 * HTML, the server sends that as plain text.
 */
export class EditorSafetyNet extends Component<{ editor: RefObject<LexicalEditor | null>; children: ReactNode }, { text: string | null }> {
  state = { text: null as string | null };

  static getDerivedStateFromError() {
    return { text: "" };
  }

  componentDidCatch() {
    this.setState({ text: plainText(this.props.editor.current) });
  }

  render() {
    const { text } = this.state;
    if (text === null) return this.props.children;
    return (
      <>
        <p role="alert" className="border-b bg-muted/40 px-5 py-3 text-sm">
          {t({ id: "editor.failed", message: "The editor stopped working, so formatting is off. Your text is kept below: finish it and send, or copy it and reload the page." })}
        </p>
        <textarea
          // Filled again once the text has been read from the editor that failed.
          key={text ? "kept" : "empty"}
          name="body"
          aria-label={t({ id: "editor.message", message: "Message" })}
          defaultValue={text}
          ref={(field) => {
            field?.focus();
            field?.setSelectionRange(field.value.length, field.value.length);
          }}
          className="block min-h-72 w-full resize-y bg-transparent px-5 py-4 text-[15px] leading-relaxed outline-none"
        />
      </>
    );
  }
}

/** What the editor last held, one line per paragraph or list item. */
function plainText(editor: LexicalEditor | null): string {
  try {
    if (!editor) return "";
    return editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((node) => ($isListNode(node) ? node.getTextContent().replace(/\n{2,}/g, "\n") : node.getTextContent()))
        .join("\n"),
    );
  } catch {
    return "";
  }
}
