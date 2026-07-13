import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { openUrl } from "@tauri-apps/plugin-opener";
import BaseCodeBlock from "@tiptap/extension-code-block";
import Image from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import BaseTaskList from "@tiptap/extension-task-list";
import BaseUnderline from "@tiptap/extension-underline";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, ReactNodeViewRenderer, type Editor as TipTapEditor, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type MarkdownIt from "markdown-it";
import insPlugin from "markdown-it-ins";
import { Markdown } from "tiptap-markdown";

import { ScrollArea } from "@/components/ui/scroll-area";
import { AiCheckDialog } from "@/components/AiCheckDialog";
import { AiRewriteDialog } from "@/components/AiRewriteDialog";
import { CodeBlockView } from "@/components/CodeBlockView";
import { ImageView } from "@/components/ImageView";
import { Toolbar } from "@/components/Toolbar";
import { checkGrammar, streamAiMarkdown, type AiActionMode, type AiCheckIssue } from "@/lib/aiClient";
import { AiDiffWidget, updateAiDiffWidget } from "@/lib/aiDiffWidget";
import { AiStreamWidget, updateAiStreamWidget } from "@/lib/aiStreamWidget";
import { EditorFileContext } from "@/lib/editorFileContext";
import { getRelativeImageMarkdownPath, saveImageToFolder } from "@/lib/fileSystem";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

// markdown-it-task-lists also converts numbered checklist syntax ("1. [ ] ...")
// into <ol data-type="taskList">, but the base extension only recognizes
// <ul data-type="taskList"> when parsing. Without this extension the "[ ]"
// brackets render as plain text instead of a clickable checkbox.
const TaskList = BaseTaskList.extend({
  parseHTML() {
    return [
      { tag: 'ul[data-type="taskList"]', priority: 51 },
      { tag: 'ol[data-type="taskList"]', priority: 51 }
    ];
  }
});

const CodeBlock = BaseCodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  }
});

// Images are referenced in markdown relative to the file (e.g. "images/foto.png"
// or "../images/foto.png"), but the browser can't load that path directly — the
// NodeView resolves it at runtime via the filesystem into a blob URL, without
// changing the stored markdown path.
// CommonMark has no image-width syntax. To keep a width changed via drag across
// save/reload, it's encoded in the title part of the standard image syntax
// (e.g. `![alt](src "width=300")`). The "title" attribute isn't used anywhere
// else in the app, so this trick is lossless and stays valid CommonMark.
const IMAGE_WIDTH_TITLE_PATTERN = /^width=(\d+)$/;

type MarkdownSerializerState = {
  esc: (str: string) => string;
  write: (content: string) => void;
  closeBlock: (node: ProseMirrorNode) => void;
};

const EditorImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const attrWidth = element.getAttribute("width");

          if (attrWidth) {
            return Number.parseInt(attrWidth, 10);
          }

          const match = element.getAttribute("title")?.match(IMAGE_WIDTH_TITLE_PATTERN);
          return match ? Number.parseInt(match[1], 10) : null;
        },
        renderHTML: (attributes) => (attributes.width ? { width: attributes.width } : {})
      },
      title: {
        ...(this.parent?.() as { title?: object } | undefined)?.title,
        parseHTML: (element) => {
          const title = element.getAttribute("title");
          return title && IMAGE_WIDTH_TITLE_PATTERN.test(title) ? null : title;
        }
      }
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const alt = (node.attrs.alt as string | null) ?? "";
          const src = (node.attrs.src as string | null) ?? "";
          const width = node.attrs.width as number | null;
          const title = width ? `width=${width}` : (node.attrs.title as string | null);

          state.write(
            `![${state.esc(alt)}](${src.replace(/[()]/g, "\\$&")}${
              title ? ` "${title.replace(/"/g, '\\"')}"` : ""
            })`
          );
          // Without this, the serializer never marks the block as closed, so
          // a following block (e.g. a heading) gets written directly onto
          // the same line with no separating newline — see closeBlock/
          // flushClose in prosemirror-markdown's to_markdown.ts.
          state.closeBlock(node);
        },
        parse: {}
      }
    };
  }
});

// CommonMark has no underline syntax. We serialize it as "++text++" (the
// markdown-it-ins plugin's syntax for <ins>) and remap the resulting tag to
// <u> when parsing, so it maps back to this mark.
const Underline = BaseUnderline.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: "++", close: "++", expelEnclosingWhitespace: true },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(insPlugin);
            markdownit.renderer.rules.ins_open = () => "<u>";
            markdownit.renderer.rules.ins_close = () => "</u>";
          }
        }
      }
    };
  }
});

// AI-generated or otherwise re-serialized markdown occasionally escapes
// brackets as "\[ \]" instead of "[ ]". markdown-it-task-lists only recognizes
// the unescaped form and otherwise renders the brackets as plain text instead
// of a checkbox. The second step handles lines starting with "[ ]"/"\[ \]" and
// no list marker at all (e.g. stray duplicate lines) — without a list marker
// markdown-it-task-lists never recognizes a checkbox, so one is added here.
function normalizeEscapedCheckboxes(markdown: string): string {
  const withUnescapedListItems = markdown.replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+)\\\[([ xX]?)\\\]/gm,
    (_match, prefix: string, mark: string) => `${prefix}[${mark || " "}]`
  );

  return withUnescapedListItems.replace(
    /^(\s*)\\?\[([ xX]?)\\?\](?=\s)/gm,
    (_match, indent: string, mark: string) => `${indent}- [${mark || " "}]`
  );
}

type EditorProps = {
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  folderPath: string | null;
  filePath: string | null;
  editorFocusRequestId?: number;
  onRequestSidebarFocus?: () => void;
  onAiLoadingChange?: (isLoading: boolean) => void;
  onAiPendingChange?: (isPending: boolean) => void;
  onAiSettingsRequest: () => void;
};

export type EditorHandle = {
  cancelAiRequest: () => void;
};

type AiDraft = {
  mode: AiActionMode;
  from: number;
  to: number;
  selectedText: string;
  selectedMarkdown: string;
};

type AiStatus = {
  kind: "info" | "error" | "success";
  message: string;
} | null;

type StreamDraft = {
  from: number;
  to: number;
  content: string;
};

function extractErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return t("editor.aiResponseError");
  }
}

function formatAiError(error: unknown, t: TFunction): string {
  console.error("AI request failed:", error);

  const rawMessage = extractErrorMessage(error, t) || t("editor.aiResponseError");

  if (
    /modell|model/i.test(rawMessage) ||
    /kein verwertbarer text|no usable text/i.test(rawMessage) ||
    /invalid/i.test(rawMessage)
  ) {
    return `${rawMessage} ${t("editor.aiTipModel")}`;
  }

  if (
    /lokalen http-endpunkt|local http endpoint/i.test(rawMessage) ||
    /network|fetch|verbind|connection/i.test(rawMessage)
  ) {
    return `${rawMessage} ${t("editor.aiTipConnection")}`;
  }

  return `${rawMessage} ${t("editor.aiTipGeneric")}`;
}

function getImageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return [];
  }

  return Array.from(dataTransfer.files).filter((file) => file.type.startsWith("image/"));
}

// Moves the list item (bullet, numbered, or task) the cursor is currently in
// one position up or down. ProseMirror has no built-in command for this, so
// the affected range is manually replaced with the two sibling nodes swapped.
// The cursor position is shifted by exactly the size of the node it passed,
// so the selection stays inside the moved item.
function moveListItem(view: EditorView, direction: "up" | "down"): boolean {
  const { state } = view;
  const { $from, from, to } = state.selection;

  let listItemDepth = -1;
  for (let depth = $from.depth; depth > 0; depth--) {
    const nodeTypeName = $from.node(depth).type.name;
    if (nodeTypeName === "listItem" || nodeTypeName === "taskItem") {
      listItemDepth = depth;
      break;
    }
  }

  if (listItemDepth === -1) {
    return false;
  }

  const parentDepth = listItemDepth - 1;
  const parent = $from.node(parentDepth);
  const index = $from.index(parentDepth);
  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (targetIndex < 0 || targetIndex >= parent.childCount) {
    return false;
  }

  const currentItem = parent.child(index);
  const siblingItem = parent.child(targetIndex);
  const itemStart = $from.before(listItemDepth);

  const rangeStart = direction === "up" ? itemStart - siblingItem.nodeSize : itemStart;
  const rangeEnd =
    direction === "up"
      ? itemStart + currentItem.nodeSize
      : itemStart + currentItem.nodeSize + siblingItem.nodeSize;
  const replacement =
    direction === "up" ? Fragment.from([currentItem, siblingItem]) : Fragment.from([siblingItem, currentItem]);
  const offset = direction === "up" ? -siblingItem.nodeSize : siblingItem.nodeSize;

  const tr = state.tr.replaceWith(rangeStart, rangeEnd, replacement);
  tr.setSelection(TextSelection.create(tr.doc, from + offset, to + offset));
  tr.scrollIntoView();

  view.dispatch(tr);
  return true;
}

function getImageFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) {
    return [];
  }

  return Array.from(clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    markdown,
    onMarkdownChange,
    folderPath,
    filePath,
    editorFocusRequestId,
    onRequestSidebarFocus,
    onAiLoadingChange,
    onAiPendingChange,
    onAiSettingsRequest
  },
  ref
) {
  const { t } = useTranslation();
  const editorRef = useRef<TipTapEditor | null>(null);
  const lastSyncedMarkdownRef = useRef(markdown);
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isAiDiffOpen, setIsAiDiffOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>(null);
  const [aiCheckIssues, setAiCheckIssues] = useState<AiCheckIssue[] | null>(null);
  const [aiCheckResolvedCount, setAiCheckResolvedCount] = useState(0);
  const aiSettings = useAiSettingsStore((state) => state.settings);
  const spellcheckEnabled = useEditorSettingsStore((state) => state.spellcheckEnabled);
  const aiStreamDraftRef = useRef<StreamDraft | null>(null);
  const aiDiffOriginalRef = useRef<{ from: number; to: number; text: string; markdown: string } | null>(null);
  const aiDiffLastResultRef = useRef<string | null>(null);
  const aiAbortControllerRef = useRef<AbortController | null>(null);
  const aiCheckRangeRef = useRef<{ from: number; to: number } | null>(null);
  const [isLinkModifierHeld, setIsLinkModifierHeld] = useState(false);

  useEffect(() => {
    const handleModifierChange = (event: KeyboardEvent) => {
      setIsLinkModifierHeld(event.ctrlKey || event.metaKey);
    };
    const handleBlur = () => setIsLinkModifierHeld(false);

    window.addEventListener("keydown", handleModifierChange);
    window.addEventListener("keyup", handleModifierChange);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleModifierChange);
      window.removeEventListener("keyup", handleModifierChange);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const updateStreamDraft = (editor: TipTapEditor, chunk: string) => {
    const streamDraft = aiStreamDraftRef.current;

    if (!streamDraft || !chunk) {
      return;
    }

    streamDraft.content += chunk;

    const sizeBefore = editor.state.doc.content.size;

    try {
      editor.commands.insertContentAt(
        { from: streamDraft.from, to: streamDraft.to },
        streamDraft.content
      );
    } catch {
      // Partial markdown (e.g. an unfinished list item) can briefly produce
      // content the schema rejects. Skip this render pass — the next chunk's
      // re-parse of the full accumulated text will recover once it completes.
      return;
    }

    const sizeAfter = editor.state.doc.content.size;

    streamDraft.to += sizeAfter - sizeBefore;
  };

  const handleLinkRequest = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    const activeHref = currentEditor.getAttributes("link").href as string | undefined;
    const nextHref = window.prompt(t("editor.linkPrompt"), activeHref ?? "https://");

    if (nextHref === null) {
      return;
    }

    const trimmedHref = nextHref.trim();

    if (!trimmedHref) {
      if (activeHref) {
        currentEditor.chain().focus().extendMarkRange("link").unsetLink().run();
      }

      return;
    }

    currentEditor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: trimmedHref })
      .run();
  };

  const insertImageFiles = async (files: File[], insertPos: number) => {
    const currentEditor = editorRef.current;

    if (!currentEditor || files.length === 0) {
      return;
    }

    if (!folderPath || !filePath) {
      setAiStatus({
        kind: "error",
        message: t("editor.imageRequiresFile")
      });
      return;
    }

    let pos = insertPos;

    for (const file of files) {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const rootRelativePath = await saveImageToFolder(folderPath, file.name, file.type, data);
        const markdownPath = await getRelativeImageMarkdownPath(folderPath, filePath, rootRelativePath);
        const altText = file.name.replace(/\.[^.]+$/, "");

        const sizeBefore = currentEditor.state.doc.content.size;
        currentEditor
          .chain()
          .focus()
          .insertContentAt(pos, { type: "image", attrs: { src: markdownPath, alt: altText } })
          .run();
        const sizeAfter = currentEditor.state.doc.content.size;

        pos += sizeAfter - sizeBefore;
      } catch (error) {
        setAiStatus({
          kind: "error",
          message: t("editor.imageInsertFailed", { fileName: file.name, error: extractErrorMessage(error, t) })
        });
      }
    }
  };

  const getSelectionMarkdown = (editor: TipTapEditor, from: number, to: number): string => {
    const markdownStorage = editor.storage as {
      markdown?: { serializer?: { serialize: (content: unknown) => string } };
    };
    const serializer = markdownStorage.markdown?.serializer;

    if (!serializer) {
      return "";
    }

    try {
      return serializer.serialize(editor.state.doc.slice(from, to).content).trim();
    } catch {
      return "";
    }
  };

  const openAiDraft = (
    mode: AiActionMode,
    from: number,
    to: number,
    selectedText: string,
    selectedMarkdown: string
  ) => {
    setAiDraft({ mode, from, to, selectedText, selectedMarkdown });
  };

  const openAiDraftFromSelection = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor || aiDiffOriginalRef.current) {
      return;
    }

    const { from, to, empty } = currentEditor.state.selection;
    const selectedText = currentEditor.state.doc.textBetween(from, to, "\n");

    if (!empty && selectedText.length > 0) {
      const selectedMarkdown = getSelectionMarkdown(currentEditor, from, to);
      openAiDraft("rewrite", from, to, selectedText, selectedMarkdown || selectedText);
      return;
    }

    openAiDraft("insert", from, to, "", "");
  };

  const handleAiContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editorRef.current) {
      return;
    }

    event.preventDefault();
    openAiDraftFromSelection();
  };

  // Shows the diff widget for a result against the tracked original — used
  // while a rewrite is still streaming (isStreaming: true, actions disabled,
  // updated on every chunk), once a generation finishes, and when a
  // cancelled "continue editing" round falls back to whatever diff was
  // showing before it was opened.
  const showAiDiff = (currentEditor: TipTapEditor, resultMarkdown: string, isStreaming = false) => {
    const original = aiDiffOriginalRef.current;

    if (!original) {
      return;
    }

    aiDiffLastResultRef.current = resultMarkdown;
    // emitUpdate=false: setEditable's default synthesizes an 'update' event
    // even though nothing in the document changed — with onMarkdownChange
    // bound to whichever file is selected *at that moment*, letting that
    // fire during a file switch would write this document's markdown into
    // the newly selected file's slot and falsely mark it as unsaved.
    currentEditor.setEditable(false, false);

    updateAiDiffWidget(currentEditor, {
      from: original.from,
      to: original.to,
      resultMarkdown,
      isStreaming,
      onAccept: () => acceptAiDiff(resultMarkdown),
      onDiscard: () => discardAiDiff(),
      onContinueEditing: () => continueEditingAiDiff(resultMarkdown)
    });
  };

  const clearAiDiff = (currentEditor: TipTapEditor) => {
    updateAiDiffWidget(currentEditor, null);
    currentEditor.setEditable(true, false);
    aiDiffOriginalRef.current = null;
    aiDiffLastResultRef.current = null;
    setIsAiDiffOpen(false);
  };

  const closeAiDraft = () => {
    if (isAiLoading) {
      return;
    }

    setAiDraft(null);

    // Cancelling the prompt dialog for a "continue editing" round must not
    // strand the diff in limbo — fall back to whatever result was showing
    // before that round was started.
    const currentEditor = editorRef.current;

    if (currentEditor && aiDiffOriginalRef.current && aiDiffLastResultRef.current !== null) {
      showAiDiff(currentEditor, aiDiffLastResultRef.current);
    }
  };

  const acceptAiDiff = (resultMarkdown: string) => {
    const currentEditor = editorRef.current;
    const original = aiDiffOriginalRef.current;

    if (!currentEditor || !original) {
      return;
    }

    // Clear the diff widget (and its from/to decoration) before mutating the
    // document: the plugin doesn't remap those positions through unrelated
    // transactions (the editor is read-only for the whole diff phase), so
    // clearing after the edit would leave it pointing at stale positions in
    // the changed document for one dispatch.
    clearAiDiff(currentEditor);
    currentEditor
      .chain()
      .focus()
      .insertContentAt({ from: original.from, to: original.to }, resultMarkdown)
      .run();
  };

  const discardAiDiff = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    // The original selection was never removed from the document, so
    // discarding is just clearing the diff widget — nothing to restore.
    clearAiDiff(currentEditor);
  };

  const continueEditingAiDiff = (resultMarkdown: string) => {
    const currentEditor = editorRef.current;
    const original = aiDiffOriginalRef.current;

    if (!currentEditor || !original) {
      return;
    }

    updateAiDiffWidget(currentEditor, null);
    currentEditor.setEditable(true, false);
    // aiDiffOriginalRef (and aiDiffLastResultRef) stay set so the diff shown
    // after this round — or a fallback if the dialog gets cancelled — still
    // compares against the very first original text.
    openAiDraft("rewrite", original.from, original.to, resultMarkdown, resultMarkdown);
  };

  const runAiDraft = async (prompt: string, includeDocument: boolean, preserveFormatting: boolean) => {
    const currentEditor = editorRef.current;
    const draft = aiDraft;

    if (!currentEditor || !draft) {
      return;
    }

    setAiDraft(null);
    setIsAiLoading(true);
    setAiStatus({ kind: "info", message: t("app.aiRequestRunning") });

    const isRewrite = draft.mode === "rewrite";

    // "insert" streams straight into the document as before. "rewrite" keeps
    // the original selection untouched and buffers the result instead, so it
    // can be shown as an accept/discard/continue-editing diff once the
    // stream finishes rather than overwriting the selection immediately.
    if (!isRewrite) {
      aiStreamDraftRef.current = { from: draft.from, to: draft.from, content: "" };
    }

    // Until the first visible answer chunk arrives, a widget at the insertion
    // point shows a live preview of the reasoning trace when thinking is
    // enabled — with thinking off there's nothing meaningful to show yet, so
    // no widget appears at all until writing actually starts (for rewrite
    // that's when the diff widget takes over and starts growing with each
    // chunk).
    const showThinkingWidget = aiSettings.thinkingMode !== "off";
    let widgetVisible = showThinkingWidget;
    let thinkingText = "";
    let streamedMarkdown = "";

    if (showThinkingWidget) {
      updateAiStreamWidget(currentEditor, { pos: draft.from, thinkingText: "" });
    }

    const hideWidget = () => {
      if (widgetVisible) {
        widgetVisible = false;

        const activeEditor = editorRef.current;

        if (activeEditor) {
          updateAiStreamWidget(activeEditor, null);
        }
      }
    };

    const abortController = new AbortController();
    aiAbortControllerRef.current = abortController;

    try {
      const request = {
        mode: draft.mode,
        prompt,
        selectedText: draft.selectedText,
        selectedMarkdown: draft.selectedMarkdown,
        documentMarkdown: markdown,
        includeDocument,
        preserveFormatting
      };

      const streamHandlers = {
        onChunk: (chunk: string) => {
          hideWidget();

          const activeEditor = editorRef.current;

          if (!isRewrite) {
            if (activeEditor) {
              updateStreamDraft(activeEditor, chunk);
            }

            return;
          }

          streamedMarkdown += chunk;

          if (activeEditor) {
            if (!aiDiffOriginalRef.current) {
              aiDiffOriginalRef.current = {
                from: draft.from,
                to: draft.to,
                text: draft.selectedText,
                markdown: draft.selectedMarkdown
              };
            }

            setIsAiDiffOpen(true);
            showAiDiff(activeEditor, streamedMarkdown, true);
          }
        },
        onThinking: (chunk: string) => {
          const activeEditor = editorRef.current;

          if (!widgetVisible || !activeEditor) {
            return;
          }

          thinkingText += chunk;
          updateAiStreamWidget(activeEditor, { pos: draft.from, thinkingText });
        }
      };

      const generatedMarkdown = normalizeEscapedCheckboxes(
        await streamAiMarkdown(aiSettings, request, streamHandlers, abortController.signal)
      );

      if (isRewrite) {
        // Fallback for the edge case where the response arrived without any
        // streamed chunks (e.g. resolved directly on completion) — the diff
        // widget was never shown yet, so the original still needs tracking.
        if (!aiDiffOriginalRef.current) {
          aiDiffOriginalRef.current = {
            from: draft.from,
            to: draft.to,
            text: draft.selectedText,
            markdown: draft.selectedMarkdown
          };
        }

        setIsAiDiffOpen(true);
        showAiDiff(currentEditor, generatedMarkdown, false);
      } else {
        const streamDraft = aiStreamDraftRef.current;

        if (streamDraft) {
          currentEditor
            .chain()
            .focus()
            .insertContentAt({ from: streamDraft.from, to: streamDraft.to }, generatedMarkdown)
            .run();
        } else {
          currentEditor.chain().focus().insertContentAt(draft.from, generatedMarkdown).run();
        }
      }

      setAiStatus(null);
    } catch (error) {
      if (abortController.signal.aborted) {
        setAiStatus(null);
      } else {
        setAiStatus({ kind: "error", message: formatAiError(error, t) });
      }
    } finally {
      hideWidget();
      setIsAiLoading(false);
      aiStreamDraftRef.current = null;
      aiAbortControllerRef.current = null;
    }
  };

  const performAiGrammarCheck = async (
    currentEditor: TipTapEditor,
    from: number,
    to: number,
    selectedText: string
  ) => {
    setIsAiLoading(true);
    setAiStatus({ kind: "info", message: t("app.aiRequestRunning") });

    const abortController = new AbortController();
    aiAbortControllerRef.current = abortController;

    try {
      const issues = await checkGrammar(aiSettings, selectedText, abortController.signal);

      aiCheckRangeRef.current = { from, to };
      setAiCheckIssues(issues);
      setAiCheckResolvedCount(0);
      // emitUpdate=false: same reasoning as showAiDiff — no document change
      // actually happened, so the file-switch/unsaved-changes tracking must
      // not misattribute a synthetic 'update' event to the current file.
      currentEditor.setEditable(false, false);
      setAiStatus(null);
    } catch (error) {
      if (abortController.signal.aborted) {
        setAiStatus(null);
      } else {
        setAiStatus({ kind: "error", message: formatAiError(error, t) });
      }
    } finally {
      setIsAiLoading(false);
      aiAbortControllerRef.current = null;
    }
  };

  const runAiGrammarCheck = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor || isAiLoading || aiDraft || aiDiffOriginalRef.current || aiCheckIssues !== null) {
      return;
    }

    const { from, to, empty } = currentEditor.state.selection;

    if (empty) {
      return;
    }

    const selectedText = currentEditor.state.doc.textBetween(from, to, "\n");

    if (!selectedText.trim()) {
      return;
    }

    void performAiGrammarCheck(currentEditor, from, to, selectedText);
  };

  const applyAiCheckIssue = (issue: AiCheckIssue) => {
    const currentEditor = editorRef.current;
    const range = aiCheckRangeRef.current;

    if (currentEditor && range) {
      const currentText = currentEditor.state.doc.textBetween(range.from, range.to, "\n");
      const matchIndex = currentText.indexOf(issue.original);

      // The AI response carries no reliable character offsets, so the
      // original passage is located by a plain text search instead. If it
      // can no longer be found (e.g. the range changed since the check ran),
      // the issue is dropped without touching the document rather than
      // blocking the rest of the list.
      if (matchIndex !== -1) {
        const foundFrom = range.from + matchIndex;
        const foundTo = foundFrom + issue.original.length;

        currentEditor
          .chain()
          .focus()
          .insertContentAt({ from: foundFrom, to: foundTo }, issue.suggestion)
          .run();

        aiCheckRangeRef.current = {
          from: range.from,
          to: range.to + (issue.suggestion.length - issue.original.length)
        };
      }
    }

    setAiCheckIssues((current) => (current ? current.filter((entry) => entry !== issue) : current));
    setAiCheckResolvedCount((count) => count + 1);
  };

  const applyAllAiCheckIssues = () => {
    for (const issue of aiCheckIssues ?? []) {
      applyAiCheckIssue(issue);
    }
  };

  const closeAiCheckDialog = () => {
    const currentEditor = editorRef.current;

    if (currentEditor) {
      currentEditor.setEditable(true, false);
    }

    setAiCheckIssues(null);
    aiCheckRangeRef.current = null;
  };

  const cancelAiRequest = () => {
    aiAbortControllerRef.current?.abort();
  };

  useImperativeHandle(ref, () => ({ cancelAiRequest }), []);

  useEffect(() => {
    onAiLoadingChange?.(isAiLoading);
  }, [isAiLoading, onAiLoadingChange]);

  // Signals "there is AI work here that would be lost by navigating away" —
  // broader than isAiLoading (which only covers the chip/cancel button while
  // a request is in flight): it also stays true for as long as an unresolved
  // diff or grammar-check result is on screen, waiting to be accepted,
  // discarded, or closed.
  useEffect(() => {
    onAiPendingChange?.(isAiLoading || isAiDiffOpen || aiCheckIssues !== null);
  }, [isAiLoading, isAiDiffOpen, aiCheckIssues, onAiPendingChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlock,
      TaskList,
      TaskItem.configure({ nested: true }),
      EditorImage,
      Underline,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Link.configure({
        autolink: false,
        linkOnPaste: false,
        openOnClick: false
      }),
      Markdown.configure({
        html: false,
        breaks: true
      }),
      AiStreamWidget,
      AiDiffWidget
    ],
    content: normalizeEscapedCheckboxes(markdown),
    editable: true,
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      lastSyncedMarkdownRef.current = markdown;
    },
    onUpdate: ({ editor }) => {
      const markdownStorage = editor.storage as {
        markdown?: { getMarkdown: () => string };
      };

      const nextMarkdown = markdownStorage.markdown?.getMarkdown() ?? markdown;
      lastSyncedMarkdownRef.current = nextMarkdown;

      onMarkdownChange(nextMarkdown);
    },
    editorProps: {
      handleDrop: (view, event, _slice, moved) => {
        if (moved) {
          return false;
        }

        const files = getImageFilesFromDataTransfer(event.dataTransfer);

        if (files.length === 0) {
          return false;
        }

        event.preventDefault();

        const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const insertPos = coordinates?.pos ?? view.state.selection.from;

        void insertImageFiles(files, insertPos);
        return true;
      },
      handlePaste: (view, event) => {
        const files = getImageFilesFromClipboard(event.clipboardData);

        if (files.length === 0) {
          return false;
        }

        event.preventDefault();

        void insertImageFiles(files, view.state.selection.from);
        return true;
      },
      handleDOMEvents: {
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;

          if (!anchor) {
            return false;
          }

          event.preventDefault();

          if (event.ctrlKey || event.metaKey) {
            void openUrl(anchor.href);
          }

          return true;
        }
      },
      handleKeyDown: (view, event) => {
        if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          onRequestSidebarFocus?.();
          return true;
        }

        if (
          event.altKey &&
          event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          (event.key === "ArrowUp" || event.key === "ArrowDown")
        ) {
          const moved = moveListItem(view, event.key === "ArrowUp" ? "up" : "down");

          if (moved) {
            event.preventDefault();
          }

          return moved;
        }

        if (!(event.ctrlKey || event.metaKey)) {
          return false;
        }

        const key = event.key.toLowerCase();

        if (key === "b") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleBold().run();
          return true;
        }

        if (key === "i") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleItalic().run();
          return true;
        }

        if (key === "k") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleCodeBlock().run();
          return true;
        }

        if (key === "m") {
          event.preventDefault();
          handleLinkRequest();
          return true;
        }

        if (key === ".") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleBulletList().run();
          return true;
        }

        if (key === "-") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleOrderedList().run();
          return true;
        }

        if (key === ",") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleTaskList().run();
          return true;
        }

        if (key === "1") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleHeading({ level: 1 }).run();
          return true;
        }

        if (key === "2") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleHeading({ level: 2 }).run();
          return true;
        }

        if (key === "3") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleHeading({ level: 3 }).run();
          return true;
        }

        if (key === "d") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleStrike().run();
          return true;
        }

        if (key === "q") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleBlockquote().run();
          return true;
        }

        if (key === "g") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleCode().run();
          return true;
        }

        if (key === "e") {
          event.preventDefault();
          openAiDraftFromSelection();
          return true;
        }

        if (key === "x" && event.shiftKey) {
          if (!view.state.selection.empty) {
            event.preventDefault();
            runAiGrammarCheck();
          }
          return true;
        }

        return false;
      },
      attributes: {
        class: "editor-view__surface prose dark:prose-invert max-w-none",
        spellcheck: String(spellcheckEnabled)
      }
    }
  });

  if (editor) {
    editorRef.current = editor;
  }

  // editorProps.attributes is only read once, at editor creation, so a
  // later toggle of the setting has to be applied to the live DOM node
  // directly instead of relying on tiptap to re-render it.
  useEffect(() => {
    editor?.view.dom.setAttribute("spellcheck", String(spellcheckEnabled));
  }, [editor, spellcheckEnabled]);

  // A focus request from outside (file tree: Tab) moves focus into the editor
  // with the cursor at the document start, so navigation can continue with
  // the arrow keys.
  // Tracks the last handled request value instead of a "skip first run" guard:
  // under React.StrictMode, mount effects run twice while refs persist, so a
  // bool guard would wrongly focus again on the second run and steal focus
  // from, e.g., the title rename after creating a new file.
  const lastHandledEditorFocusRequestRef = useRef(editorFocusRequestId);

  useEffect(() => {
    if (lastHandledEditorFocusRequestRef.current === editorFocusRequestId) {
      return;
    }

    lastHandledEditorFocusRequestRef.current = editorFocusRequestId;
    editorRef.current?.commands.focus("start");
  }, [editorFocusRequestId]);

  // Switching to a different file must not leave a stale diff (and a
  // read-only editor) behind, nor let an in-flight AI request keep running
  // against this (about to be orphaned) editor instance: since rewrite no
  // longer dirties the document up front, App.tsx's unsaved-changes guard
  // can't rely on isDirty alone to block navigation here (see
  // onAiPendingChange below) — if navigation happens anyway, a request that
  // finishes after the switch would call onMarkdownChange (bound to
  // whichever file is selected *at that time*) and silently overwrite the
  // next file's content with this one's result.
  useEffect(() => {
    return () => {
      aiAbortControllerRef.current?.abort();

      const currentEditor = editorRef.current;

      if (aiDiffOriginalRef.current && currentEditor && !currentEditor.isDestroyed) {
        clearAiDiff(currentEditor);
      }
    };
  }, [filePath]);

  useEffect(() => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    const currentMarkdownStorage = currentEditor.storage as {
      markdown?: { getMarkdown: () => string };
    };
    const currentMarkdown = currentMarkdownStorage.markdown?.getMarkdown() ?? "";

    if (markdown === lastSyncedMarkdownRef.current || markdown === currentMarkdown) {
      lastSyncedMarkdownRef.current = markdown;
      return;
    }

    currentEditor.commands.setContent(normalizeEscapedCheckboxes(markdown), { emitUpdate: false });
    lastSyncedMarkdownRef.current = markdown;
  }, [markdown, editor]);

  if (!editor) {
    return null;
  }

  return (
    <div className="editor-view">
      {aiStatus && aiStatus.kind !== "info" ? (
        <div
          className={
            aiStatus.kind === "error"
              ? "editor-view__feedback editor-view__feedback--error"
              : "editor-view__feedback editor-view__feedback--success"
          }
          aria-live="polite"
        >
          <span className="editor-view__feedback-message">{aiStatus.message}</span>
        </div>
      ) : null}

      <Toolbar
        editor={editor}
        onLinkRequest={handleLinkRequest}
        onAiRequest={openAiDraftFromSelection}
        onAiCheckRequest={runAiGrammarCheck}
        onAiSettingsRequest={onAiSettingsRequest}
      />

      <EditorFileContext.Provider value={{ folderPath, filePath }}>
        <ScrollArea className="editor-view__scroll">
          <EditorContent
            editor={editor}
            className={
              isLinkModifierHeld ? "editor-view__content editor-view__content--link-hint" : "editor-view__content"
            }
            onContextMenu={handleAiContextMenu}
          />
        </ScrollArea>
      </EditorFileContext.Provider>

      <AiRewriteDialog
        open={aiDraft !== null}
        mode={aiDraft?.mode ?? "insert"}
        selectedText={aiDraft?.selectedText ?? ""}
        selectedMarkdown={aiDraft?.selectedMarkdown ?? ""}
        isLoading={isAiLoading}
        onSubmit={(prompt, includeDocument, preserveFormatting) => {
          void runAiDraft(prompt, includeDocument, preserveFormatting);
        }}
        onCancel={closeAiDraft}
      />

      <AiCheckDialog
        open={aiCheckIssues !== null}
        issues={aiCheckIssues ?? []}
        resolvedCount={aiCheckResolvedCount}
        onApply={applyAiCheckIssue}
        onApplyAll={applyAllAiCheckIssues}
        onClose={closeAiCheckDialog}
      />
    </div>
  );
});