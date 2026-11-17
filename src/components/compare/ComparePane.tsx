import { createDocument } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { ChevronDown, ChevronUp, Diff, MessageSquarePlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { readVaultAttachment } from "@/lib/chat/attachedFiles";
import { CODE_LINK_ATTR } from "@/lib/editor/codeBlockLinks";
import { COMPARE_HUNK_ATTRIBUTE, buildCompareDecorations, setCompareDecorations } from "@/lib/editor/compareHighlight";
import { compareDocuments, type CompareHunk } from "@/lib/editor/compareNotes";
import { buildCompareExtensions } from "@/lib/editor/extensions";
import { isFileLinkHref, resolveFileLinkTarget } from "@/lib/editor/fileLinks";
import { EditorFileContext } from "@/lib/editorFileContext";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { getNoteDisplayName } from "@/lib/folderNotes";
import { cn } from "@/lib/utils";
import { platform } from "@/platform";
import { readTextFile } from "@/platform/vaultFs";
import { useAppStore } from "@/store/useAppStore";
import { useChatStore } from "@/store/useChatStore";
import { COMPARE_PANE_MIN_WIDTH, useCompareStore } from "@/store/useCompareStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

type MarkdownStorage = { markdown?: { parser?: { parse(markdown: string): string } } };

// The open note is compared a moment after the typing stops, not on every
// keystroke: a parse of both notes per character is wasted on text that is
// still being written.
const COMPARE_DEBOUNCE_MS = 300;
const KEYBOARD_STEP = 16;
// The editor keeps at least this much of the window.
const EDITOR_MIN_SHARE = 0.35;

type ComparePaneProps = {
  folderPath: string | null;
  /** The compared note (absolute path, as the tree spells it). */
  filePath: string;
  /** Markdown of the note open in the editor, unsaved edits included. */
  mainMarkdown: string;
  onRequestFileOpen: (filePath: string) => void;
};

/**
 * "Open as reference": another note of the vault, read-only, beside the editor.
 * What it shows is what the note holds now: unsaved edits from an earlier
 * visit in the editor if there are any, the file otherwise, read again when
 * it changes on disk. A link in it opens its target in the editor, the way
 * a link in the document does.
 */
export function ComparePane({ folderPath, filePath, mainMarkdown, onRequestFileOpen }: ComparePaneProps) {
  const { t } = useTranslation();
  const close = useCompareStore((state) => state.close);
  const highlight = useCompareStore((state) => state.highlight);
  const setHighlight = useCompareStore((state) => state.setHighlight);
  const width = useCompareStore((state) => state.width);
  const setWidth = useCompareStore((state) => state.setWidth);
  const filePaths = useAppStore((state) => state.filePaths);
  // Unsaved edits made to the note earlier are what it holds now.
  const unsavedContent = useAppStore((state) => {
    const document = state.fileDocuments[filePath];

    return document && document.content !== document.baseContent ? document.content : null;
  });
  // Bumped by the folder refresh when the file changed on disk.
  const fileMtime = useAppStore((state) => state.fileMtimeMs[filePath]);
  const aiFeaturesVisible = useEditorSettingsStore((state) => state.aiFeaturesVisible);
  const paperSurface = useEditorSettingsStore((state) => state.paperSurface);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [hunks, setHunks] = useState<CompareHunk[]>([]);
  const [activeHunk, setActiveHunk] = useState(-1);
  const [isResizing, setIsResizing] = useState(false);
  const [attachState, setAttachState] = useState<"idle" | "done" | "failed">("idle");
  // Bumped once the new content is in the document, so the comparison runs
  // on that document and not on the one before it.
  const [contentRevision, setContentRevision] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const relativePath = folderPath ? getRelativeDisplayPath(folderPath, filePath) : filePath;
  const name = getNoteDisplayName(relativePath);
  const folderLabel = relativePath.split("/").slice(0, -1).join("/");

  useEffect(() => {
    if (unsavedContent !== null) {
      setMarkdown(unsavedContent);
      setLoadError(false);
      return;
    }

    let cancelled = false;

    readTextFile(filePath)
      .then((content) => {
        if (!cancelled) {
          setMarkdown(content);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, unsavedContent, fileMtime]);

  useEffect(() => {
    setAttachState("idle");
    setActiveHunk(-1);
  }, [filePath]);

  const editor = useEditor(
    {
      extensions: buildCompareExtensions(),
      content: "",
      editable: false,
      editorProps: {
        attributes: {
          class: "editor-view__surface compare-pane__surface prose dark:prose-invert max-w-none"
        }
      }
    },
    [filePath]
  );

  useEffect(() => {
    if (!editor || markdown === null) {
      return;
    }

    // Outside React's commit: the image node views are React renderers, and
    // creating them from inside an effect makes React warn about flushSync.
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) {
        return;
      }

      try {
        editor.commands.setContent(markdown);
        setContentRevision((revision) => revision + 1);
      } catch {
        setLoadError(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [editor, markdown]);

  useEffect(() => {
    editor?.view.dom.classList.toggle("editor-view__surface--paper", paperSurface);
  }, [editor, paperSurface]);

  // The comparison itself. Off, it costs nothing: no parse of the open note.
  useEffect(() => {
    if (!editor || contentRevision === 0) {
      return;
    }

    if (!highlight) {
      setCompareDecorations(editor, null);
      setHunks([]);
      return;
    }

    const timer = window.setTimeout(() => {
      if (editor.isDestroyed) {
        return;
      }

      const parser = (editor.storage as MarkdownStorage).markdown?.parser;

      if (!parser) {
        return;
      }

      try {
        const mainDoc = createDocument(parser.parse(mainMarkdown), editor.schema, editor.options.parseOptions);
        const { refBlocks, hunks: nextHunks } = compareDocuments(editor.state.doc, mainDoc);

        setCompareDecorations(
          editor,
          buildCompareDecorations(editor.state.doc, {
            blocks: refBlocks,
            hunks: nextHunks,
            labels: {
              changed: t("compare.changedHint"),
              missing: t("compare.missingHint"),
              extra: (count) => t("compare.onlyInOpenNote", { count })
            }
          })
        );
        setHunks(nextHunks);
        setActiveHunk((index) => (index < nextHunks.length ? index : -1));
      } catch {
        // A note the parser chokes on is shown unmarked rather than not at all.
        setHunks([]);
      }
    }, COMPARE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [editor, contentRevision, mainMarkdown, highlight, t]);

  const jumpToHunk = (index: number) => {
    const target = scrollRef.current?.querySelector(`[${COMPARE_HUNK_ATTRIBUTE}="${index}"]`);

    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      setActiveHunk(index);
    }
  };

  const stepHunk = (delta: 1 | -1) => {
    if (hunks.length === 0) {
      return;
    }

    const next = activeHunk === -1
      ? (delta === 1 ? 0 : hunks.length - 1)
      : (activeHunk + delta + hunks.length) % hunks.length;
    jumpToHunk(next);
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest("a[href]");

    if (!anchor) {
      const codeLink = target?.closest(`[${CODE_LINK_ATTR}]`)?.getAttribute(CODE_LINK_ATTR);

      if (codeLink) {
        event.preventDefault();
        void platform.shell.openUrl(codeLink);
      }

      return;
    }

    event.preventDefault();
    // The raw attribute: the DOM property resolves a relative path against
    // the app's own base URL.
    const rawHref = anchor.getAttribute("href") ?? "";

    if (isFileLinkHref(rawHref)) {
      const targetFilePath = resolveFileLinkTarget(rawHref, filePath, filePaths);

      if (targetFilePath) {
        onRequestFileOpen(targetFilePath);
      }
    } else {
      void platform.shell.openUrl((anchor as HTMLAnchorElement).href);
    }
  };

  const maxWidth = () => Math.max(COMPARE_PANE_MIN_WIDTH, Math.round(window.innerWidth * (1 - EDITOR_MIN_SHARE) - 320));
  const clampWidth = (value: number) => Math.min(maxWidth(), Math.max(COMPARE_PANE_MIN_WIDTH, value));

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    setIsResizing(true);
    document.body.classList.add("is-resizing-details-panel");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      // The pane sits left of the document: dragging right grows it.
      setWidth(clampWidth(startWidth + (moveEvent.clientX - startX)));
    };

    const stopResizing = () => {
      setIsResizing(false);
      document.body.classList.remove("is-resizing-details-panel");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setWidth(clampWidth(width + (event.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP)));
    }
  };

  const attachToChat = async () => {
    const attachment = await readVaultAttachment(folderPath, filePath);

    if (!attachment) {
      setAttachState("failed");
      return;
    }

    const chat = useChatStore.getState();

    // Opening the panel starts a fresh chat, which drops its attachments:
    // open first, attach after.
    if (!chat.isOpen) {
      chat.openPanel();
    }

    useChatStore.getState().attachFiles([attachment]);
    setAttachState("done");
  };

  const fileContext = useMemo(
    () => ({ folderPath, filePath, onEditDrawing: null, onDrawOnImage: null }),
    [folderPath, filePath]
  );

  const countLabel = hunks.length === 0 ? t("compare.noDifferences") : t("compare.differences", { count: hunks.length });

  return (
    <>
      <aside
        className="compare-pane"
        style={{ width }}
        aria-label={t("compare.paneLabel", { name })}
        data-testid="compare-pane"
      >
        <div className="compare-pane__header">
          <div className="compare-pane__title" title={relativePath}>
            <span className="compare-pane__eyebrow">{t("compare.eyebrow")}</span>
            <span className="compare-pane__name">{name}</span>
            {folderLabel ? <span className="compare-pane__folder">{folderLabel}</span> : null}
          </div>
          <div className="compare-pane__actions">
            <Button
              type="button"
              size="icon-sm"
              variant={highlight ? "secondary" : "ghost"}
              aria-pressed={highlight}
              aria-label={t("compare.highlight")}
              title={t("compare.highlight")}
              data-testid="compare-highlight"
              onClick={() => setHighlight(!highlight)}
            >
              <Diff />
            </Button>
            {aiFeaturesVisible ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("compare.attachToChat")}
                title={
                  attachState === "done"
                    ? t("compare.attachedToChat")
                    : attachState === "failed"
                      ? t("compare.attachFailed")
                      : t("compare.attachToChat")
                }
                onClick={() => void attachToChat()}
              >
                <MessageSquarePlus />
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("compare.close")}
              title={t("compare.close")}
              data-testid="compare-close"
              onClick={close}
            >
              <X />
            </Button>
          </div>
        </div>
        {highlight ? (
          <div className="compare-pane__diffbar" aria-live="polite">
            <span className="compare-pane__count">{countLabel}</span>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={hunks.length === 0}
              aria-label={t("compare.previous")}
              title={t("compare.previous")}
              onClick={() => stepHunk(-1)}
            >
              <ChevronUp />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={hunks.length === 0}
              aria-label={t("compare.next")}
              title={t("compare.next")}
              onClick={() => stepHunk(1)}
            >
              <ChevronDown />
            </Button>
            {/* What the three colours mean, right where they are switched on. */}
            <div className="compare-pane__legend">
              <span className="compare-pane__legend-item" title={t("compare.changedHint")}>
                <span className="compare-pane__swatch compare-pane__swatch--changed" aria-hidden="true" />
                {t("compare.legendChanged")}
              </span>
              <span className="compare-pane__legend-item" title={t("compare.missingHint")}>
                <span className="compare-pane__swatch compare-pane__swatch--missing" aria-hidden="true" />
                {t("compare.legendMissing")}
              </span>
              <span className="compare-pane__legend-item" title={t("compare.extraHint")}>
                <span className="compare-pane__swatch compare-pane__swatch--extra" aria-hidden="true" />
                {t("compare.legendExtra")}
              </span>
            </div>
          </div>
        ) : null}
        {loadError ? (
          <div className="compare-pane__message">{t("compare.loadFailed")}</div>
        ) : (
          <EditorFileContext.Provider value={fileContext}>
            <div className="scroll-area compare-pane__scroll" ref={scrollRef}>
              <EditorContent editor={editor} className="compare-pane__content" onClick={handleClick} />
            </div>
          </EditorFileContext.Provider>
        )}
      </aside>
      {/* On the pane's right edge, between it and the document. */}
      <div
        className={cn("workspace-resizer", isResizing && "workspace-resizer--active")}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("compare.resizeLabel")}
        aria-valuenow={width}
        aria-valuemin={COMPARE_PANE_MIN_WIDTH}
        tabIndex={0}
        onPointerDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
      >
        <span className="workspace-resizer__grip" aria-hidden="true" />
      </div>
    </>
  );
}
