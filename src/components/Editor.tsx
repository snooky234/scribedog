import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { openUrl } from "@tauri-apps/plugin-opener";
import { EditorContent, type Editor as TipTapEditor, useEditor } from "@tiptap/react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { AiCheckDialog } from "@/components/AiCheckDialog";
import { FindReplacePanel } from "@/components/FindReplacePanel";
import { AiRewriteDialog } from "@/components/AiRewriteDialog";
import { VoiceModelDownloadDialog } from "@/components/VoiceModelDownloadDialog";
import { VoiceRecordingBanner } from "@/components/VoiceRecordingBanner";
import { Toolbar } from "@/components/Toolbar";
import { useAiEditorActions } from "@/components/editor/useAiEditorActions";
import { useEditorDictation } from "@/components/editor/useEditorDictation";
import { EditorFileContext } from "@/lib/editorFileContext";
import { normalizeEscapedCheckboxes } from "@/lib/editor/markdownNormalize";
import { buildEditorExtensions } from "@/lib/editor/extensions";
import { extractErrorMessage } from "@/lib/editor/errorMessages";
import { getImageFilesFromClipboard, getImageFilesFromDataTransfer } from "@/lib/editor/imageTransfer";
import { moveListItem } from "@/lib/editor/listCommands";
import { getEditorMarkdown } from "@/lib/editor/markdownStorage";
import { getRelativeImageMarkdownPath, saveImageToFolder } from "@/lib/fileSystem";
import { updateSearchHighlight } from "@/lib/searchHighlight";
import { printMarkdown } from "@/lib/print";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";

type EditorProps = {
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  folderPath: string | null;
  filePath: string | null;
  editorFocusRequestId?: number;
  onRequestSidebarFocus?: () => void;
  onRequestFileOpen?: (filePath: string) => void;
  onAiLoadingChange?: (isLoading: boolean) => void;
  onAiPendingChange?: (isPending: boolean) => void;
  onAiSettingsRequest: () => void;
  onAssistantSettingsRequest: () => void;
};

export type EditorHandle = {
  cancelAiRequest: () => void;
  printDocument: () => void;
};

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    markdown,
    onMarkdownChange,
    folderPath,
    filePath,
    editorFocusRequestId,
    onRequestSidebarFocus,
    onRequestFileOpen,
    onAiLoadingChange,
    onAiPendingChange,
    onAiSettingsRequest,
    onAssistantSettingsRequest
  },
  ref
) {
  const { t } = useTranslation();
  const editorRef = useRef<TipTapEditor | null>(null);
  const lastSyncedMarkdownRef = useRef(markdown);
  const spellcheckEnabled = useEditorSettingsStore((state) => state.spellcheckEnabled);
  const [isLinkModifierHeld, setIsLinkModifierHeld] = useState(false);

  const ai = useAiEditorActions({ editorRef, markdown, filePath, onAiLoadingChange, onAiPendingChange });
  const { dictation, toggleDictation } = useEditorDictation({
    editorRef,
    setStatus: ai.setAiStatus,
    isDiffActive: ai.isDiffActive,
    isBusyForDictation: ai.isBusyForDictation
  });

  // Panel visibility (and the whole search state) lives in useSearchStore
  // so it survives the per-file remount of this component during
  // cross-file match navigation.
  const openFindPanel = () => {
    useSearchStore.getState().openPanel();
  };

  const closeFindPanel = () => {
    useSearchStore.getState().closePanel();

    const currentEditor = editorRef.current;

    if (currentEditor) {
      updateSearchHighlight(currentEditor, null);
      currentEditor.commands.focus();
    }
  };

  // Ctrl+F must work regardless of where the focus currently is (editor,
  // toolbar, sidebar), so it's registered at window level rather than in
  // the ProseMirror keymap.
  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        openFindPanel();
      }
    };

    window.addEventListener("keydown", handleFindShortcut);

    return () => window.removeEventListener("keydown", handleFindShortcut);
  }, []);

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
      ai.setAiStatus({
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
        ai.setAiStatus({
          kind: "error",
          message: t("editor.imageInsertFailed", { fileName: file.name, error: extractErrorMessage(error, t) })
        });
      }
    }
  };

  const printDocument = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    const currentMarkdown = getEditorMarkdown(currentEditor, markdown);

    printMarkdown(currentMarkdown, filePath).catch((error: unknown) => {
      console.error("Print failed:", error);
    });
  };

  useImperativeHandle(ref, () => ({ cancelAiRequest: ai.cancelAiRequest, printDocument }), [ai]);

  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content: normalizeEscapedCheckboxes(markdown),
    editable: true,
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      lastSyncedMarkdownRef.current = markdown;
    },
    onUpdate: ({ editor }) => {
      const nextMarkdown = getEditorMarkdown(editor, markdown);
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

        if (key === "o" && event.shiftKey) {
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

          // Ctrl+Shift+E opens the AI dialog and immediately starts voice
          // input into the prompt field (issue #7).
          if (event.shiftKey) {
            ai.setVoiceStartRequestId((id) => id + 1);
          }

          ai.openAiDraftFromSelection();
          return true;
        }

        if (key === "w" && event.shiftKey) {
          event.preventDefault();
          toggleDictation();
          return true;
        }

        if (key === "x" && event.shiftKey) {
          if (!view.state.selection.empty) {
            event.preventDefault();
            ai.runAiGrammarCheck();
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

  useEffect(() => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    const currentMarkdown = getEditorMarkdown(currentEditor, "");

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
      {dictation.status === "recording" || dictation.status === "transcribing" ? (
        <VoiceRecordingBanner
          level={dictation.level}
          isRecording={dictation.status === "recording"}
          message={dictation.status === "recording" ? t("voice.editorRecordingHint") : t("voice.transcribing")}
        />
      ) : null}

      {ai.aiStatus && ai.aiStatus.kind !== "info" ? (
        <div
          className={
            ai.aiStatus.kind === "error"
              ? "editor-view__feedback editor-view__feedback--error"
              : "editor-view__feedback editor-view__feedback--success"
          }
          aria-live="polite"
        >
          <span className="editor-view__feedback-message">{ai.aiStatus.message}</span>
        </div>
      ) : null}

      <Toolbar
        editor={editor}
        onLinkRequest={handleLinkRequest}
        onAiRequest={ai.openAiDraftFromSelection}
        onAiCheckRequest={ai.runAiGrammarCheck}
        onAiSettingsRequest={onAiSettingsRequest}
        onAssistantSettingsRequest={onAssistantSettingsRequest}
        onPrintRequest={printDocument}
        onSearchRequest={openFindPanel}
      />

      <EditorFileContext.Provider value={{ folderPath, filePath }}>
        <div className="editor-view__body">
          <FindReplacePanel
            editor={editor}
            folderPath={folderPath}
            filePath={filePath}
            onClose={closeFindPanel}
            onRequestFileOpen={onRequestFileOpen}
          />
          <ScrollArea className="editor-view__scroll">
            <EditorContent
              editor={editor}
              className={
                isLinkModifierHeld ? "editor-view__content editor-view__content--link-hint" : "editor-view__content"
              }
              onContextMenu={ai.handleAiContextMenu}
            />
          </ScrollArea>
        </div>
      </EditorFileContext.Provider>

      <AiRewriteDialog
        open={ai.aiDraft !== null}
        mode={ai.aiDraft?.mode ?? "insert"}
        selectedText={ai.aiDraft?.selectedText ?? ""}
        selectedMarkdown={ai.aiDraft?.selectedMarkdown ?? ""}
        isLoading={ai.isAiLoading}
        voiceStartRequestId={ai.voiceStartRequestId}
        onSubmit={(prompt, includeDocument, preserveFormatting) => {
          void ai.runAiDraft(prompt, includeDocument, preserveFormatting);
        }}
        onCancel={ai.closeAiDraft}
      />

      <VoiceModelDownloadDialog
        open={dictation.isModelDialogOpen}
        onClose={dictation.closeModelDialog}
        onDownloaded={dictation.handleModelDownloaded}
      />

      <AiCheckDialog
        open={ai.aiCheckIssues !== null}
        issues={ai.aiCheckIssues ?? []}
        resolvedCount={ai.aiCheckResolvedCount}
        onApply={ai.applyAiCheckIssue}
        onApplyAll={ai.applyAllAiCheckIssues}
        onClose={ai.closeAiCheckDialog}
      />
    </div>
  );
});