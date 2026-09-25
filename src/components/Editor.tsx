import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { getVaultCapabilities, platform, vaultCapabilityHint } from "@/platform";
import type { PickedImageFile } from "@/platform/types";
import { EditorContent, type Editor as TipTapEditor, useEditor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AiCheckDialog } from "@/components/AiCheckDialog";
import { FindReplacePanel } from "@/components/FindReplacePanel";
import { AiRewriteDialog } from "@/components/AiRewriteDialog";
import { LinkDialog, type LinkDialogResult } from "@/components/LinkDialog";
import { VoiceModelDownloadDialog } from "@/components/VoiceModelDownloadDialog";
import { VoiceRecordingBanner } from "@/components/VoiceRecordingBanner";
import { Toolbar } from "@/components/Toolbar";
import { FileLinkSuggestionPopover } from "@/components/editor/FileLinkSuggestionPopover";
import { DetailsPanel } from "@/components/editor/DetailsPanel";
import { SelectionContextMenu, type SelectionContextMenuState } from "@/components/editor/SelectionContextMenu";
import { StagedChangeBar } from "@/components/editor/StagedChangeBar";
import { MobileSheet } from "@/components/app/MobileSheet";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import {
  DETAILS_PANEL_MAX_WIDTH,
  DETAILS_PANEL_MIN_WIDTH,
  useDetailsPanelWidth
} from "@/hooks/useDetailsPanelWidth";
import { useAiEditorActions } from "@/components/editor/useAiEditorActions";
import { useEditorDictation } from "@/components/editor/useEditorDictation";
import { useFileLinkSuggestion } from "@/components/editor/useFileLinkSuggestion";
import { useContextMenuState } from "@/components/fileTree/useContextMenuState";
import {
  acceptAllAiSuggestions,
  addAiSuggestion,
  clearAiSuggestions,
  getAiSuggestions,
  setAiSuggestionOverride
} from "@/lib/aiSuggestionWidget";
import type { ImageWidthChange, ProposalOutcome } from "@/lib/chat/agentTools";
import {
  findStagedChange,
  normalizeVaultPath,
  stagedChangeKind
} from "@/lib/chat/vaultStaging";
import { CODE_LINK_ATTR } from "@/lib/editor/codeBlockLinks";
import { buildStagedPreview } from "@/lib/editor/stagedPreview";
import { normalizeImageSrc } from "@/lib/chat/imageAttachments";
import { EditorFileContext } from "@/lib/editorFileContext";
import { buildEditorExtensions } from "@/lib/editor/extensions";
import { duplicatedImageSources } from "@/lib/editor/documentImages";
import { hasHeading, type OutlineHeading } from "@/lib/editor/documentOutline";
import { updateOutlineHighlight } from "@/lib/editor/outlineHighlight";
import { isDuplicateInsertion, rewrittenAnchorRange } from "@/lib/editor/duplicateInsertion";
import {
  buildFileLinkHref,
  buildVaultFileOptions,
  decodeFileLinkHref,
  getDraggedVaultFilePaths,
  getFileLinkLabel,
  isFileLinkHref,
  resolveFileLinkTarget,
  type VaultFileOption
} from "@/lib/editor/fileLinks";
import { extractErrorMessage } from "@/lib/editor/errorMessages";
import { hasAnchorableContent, resolveInsertAnchor } from "@/lib/editor/insertAnchor";
import {
  getImageFilesFromClipboard,
  getImageFilesFromDataTransfer,
  getNonImageFilesFromDataTransfer
} from "@/lib/editor/imageTransfer";
import { moveLine, moveListItem, toggleTaskItemChecked } from "@/lib/editor/listCommands";
import { normalizeEscapedCheckboxes } from "@/lib/editor/markdownNormalize";
import { looksLikeMarkdown, pasteMarkdown } from "@/lib/editor/pasteMarkdown";
import { normalizePastedSlice } from "@/lib/editor/pasteNormalize";
import { adoptPastedImages } from "@/lib/editor/pastedImages";
import { getEditorMarkdown, getSelectionMarkdown } from "@/lib/editor/markdownStorage";
import { serializeGuarded } from "@/lib/editor/serializationGuard";
import {
  copySelectionAsMarkdown,
  copySelectionAsPlainText,
  copySelectionFormatted,
  type SelectionRange
} from "@/lib/editor/selectionClipboard";
import { findTextRange } from "@/lib/editor/textSearch";
import {
  getLastOpenedFolderPath,
  getRelativeDisplayPath,
  getRelativeImageMarkdownPath,
  saveImageToFolder
} from "@/lib/fileSystem";
import { holdClipboardImages } from "@/lib/clipboardImages";
import { updateSearchHighlight } from "@/lib/searchHighlight";
import { canDownloadMarkdown, downloadNoteAsMarkdown } from "@/lib/export/markdownDownload";
import { printMarkdown } from "@/lib/print";
import { couldBeShortcut } from "@/lib/shortcuts/binding";
import { matchFixedEditorShortcut } from "@/lib/shortcuts/fixed";
import { isRetiredDefault, matchShortcut } from "@/lib/shortcuts/resolve";
import { useAppStore } from "@/store/useAppStore";
import { useChatStore } from "@/store/useChatStore";
import { useStagedChangesStore } from "@/store/useStagedChangesStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";
import { useShortcutsStore } from "@/store/useShortcutsStore";

// What the editor embeds as an image — the toolbar's file filter and the drop
// handler share this list, so both accept exactly the same files.
const EDITOR_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

// Marks the surface as a light page inside the dark UI; tokens.css and the
// dark variant in App.css key off this exact name.
const PAPER_SURFACE_CLASS = "editor-view__surface--paper";

type EditorProps = {
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  onCanonicalMarkdown?: (filePath: string, markdown: string) => void;
  folderPath: string | null;
  filePath: string | null;
  editorFocusRequestId?: number;
  onRequestSidebarFocus?: () => void;
  onRequestFileOpen?: (filePath: string) => void;
  onAiLoadingChange?: (isLoading: boolean) => void;
  onAiPendingChange?: (isPending: boolean) => void;
  onAiSettingsRequest: () => void;
  onZenModeRequest: () => void;
  /** Where the toolbar renders instead of inside the editor (the document
   *  panel's slot above the title row on desktop); null keeps it inline. */
  toolbarContainer?: HTMLElement | null;
};

export type EditorHandle = {
  cancelAiRequest: () => void;
  printDocument: () => void;
  getMarkdown: () => string;
  getSelectionText: () => string;
  /**
   * The selected range, for a caller that is about to take the focus away:
   * ProseMirror collapses its selection when the editor is blurred, so the
   * document header's menu keeps the range from before it opened and hands
   * it back to `copyRange`.
   */
  getSelectionRange: () => SelectionRange | null;
  copyRange: (range: SelectionRange, variant: "markdown" | "plainText") => void;
  listImageSources: () => string[];
  listPendingProposals: () => string[];
  acceptPendingProposals: () => number;
  discardPendingProposals: () => number;
  proposeSelectionReplacement: (markdown: string) => ProposalOutcome;
  proposeInsertion: (markdown: string, anchorText?: string) => ProposalOutcome;
  proposePassageReplacement: (oldText: string, newText: string) => ProposalOutcome;
  setImageWidth: (
    src: string,
    request: { width?: number; scale?: number }
  ) => ImageWidthChange | null;
};

type LinkDialogState = {
  /** Href of the link the caret sits in, "" for a new link. */
  href: string;
  selectedText: string;
  isLinkActive: boolean;
};

// The selected passage as markdown — the form the chat agent's get_selection
// tool and the composer's selection chip both work with. Plain text would drop
// exactly the markers the agent has to carry over when it rewrites or extends
// the passage: a selected checklist would come back as bare sentences.
function selectionText(editor: TipTapEditor): string {
  const { from, to } = editor.state.selection;

  return normalizeEscapedCheckboxes(
    getSelectionMarkdown(editor, from, to) || editor.state.doc.textBetween(from, to, "\n")
  );
}

// Turns a node selection (a selected image with its resize handles) into a
// caret before the node. The resize handles and the toolbar prevent the
// default on pointer/mouse down, so neither takes focus away from the editor.
function collapseNodeSelection(editor: TipTapEditor): void {
  const { selection } = editor.state;

  if (selection instanceof NodeSelection) {
    editor.commands.setTextSelection(selection.from);
  }
}

// Records which images a cut or copy just put on the clipboard (see
// lib/clipboardImages.ts): an image cut out of this note has to survive the
// save that follows the cut, and a paste into a note in another folder has to
// rewrite its path. Plain text carries no image, so its copy passes null.
function holdCopiedImages(doc: ProseMirrorNode, range: SelectionRange | null): void {
  const sources: string[] = [];

  if (range) {
    const size = doc.content.size;

    doc.nodesBetween(Math.min(range.from, size), Math.min(range.to, size), (node) => {
      const src = node.type.name === "image" ? ((node.attrs.src as string | null) ?? "") : "";

      if (src) {
        sources.push(src);
      }
    });
  }

  holdClipboardImages(useAppStore.getState().selectedFilePath, sources);
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    markdown,
    onMarkdownChange,
    onCanonicalMarkdown,
    folderPath,
    filePath,
    editorFocusRequestId,
    onRequestSidebarFocus,
    onRequestFileOpen,
    onAiLoadingChange,
    onAiPendingChange,
    onAiSettingsRequest,
    onZenModeRequest,
    toolbarContainer = null
  },
  ref
) {
  const { t } = useTranslation();
  const editorRef = useRef<TipTapEditor | null>(null);
  // The pointer type of the last press inside the editor, for the context
  // menu guard below: the event itself does not always say where it came from.
  const lastPointerTypeRef = useRef<string | null>(null);
  // Set by Ctrl+Shift+V and consumed by the paste event it triggers: the
  // clipboard event itself carries no modifier state.
  const plainPasteRequestedRef = useRef(false);
  // True while a paste event is being handled: transformPasted also runs for
  // a drop, which moves an image inside this note and must not count as the
  // paste of the clipboard's images.
  const pastingRef = useRef(false);
  const lastSyncedMarkdownRef = useRef(markdown);
  // Kept in a ref so the sync effect below doesn't re-run for a new callback
  // identity: it may only react to actual content changes. Declared up here
  // because the editor's onUpdate reaches for it too.
  const onCanonicalMarkdownRef = useRef(onCanonicalMarkdown);
  onCanonicalMarkdownRef.current = onCanonicalMarkdown;
  const spellcheckEnabled = useEditorSettingsStore((state) => state.spellcheckEnabled);
  const paperSurface = useEditorSettingsStore((state) => state.paperSurface);
  const detailsPanelVisible = useEditorSettingsStore((state) => state.detailsPanelVisible);
  const layout = useLayoutMode();
  // Phone and tablet show the panel as a sheet with its own switch (see the
  // store), and have one right-hand sheet: while the chat is open it covers
  // the details, which come back when the chat closes (the flag stays set,
  // so nothing is lost).
  const detailsSheetOpen = useEditorSettingsStore((state) => state.detailsSheetOpen);
  const setDetailsSheetOpen = useEditorSettingsStore((state) => state.setDetailsSheetOpen);
  const isChatOpen = useChatStore((state) => state.isOpen);
  const setDetailsPanelVisible = useEditorSettingsStore((state) => state.setDetailsPanelVisible);
  const {
    detailsPanelWidth,
    isResizingDetailsPanel,
    handleDetailsPanelResizeStart,
    handleDetailsPanelResizeKeyDown
  } = useDetailsPanelWidth();
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);
  // Node types the serializer replaced with a placeholder in the last
  // serialization (see lib/editor/serializationGuard). While the list is
  // not empty the document is not reported to the store, so nothing with a
  // placeholder in it can reach the disk, and a banner says so.
  const [unserializableNodes, setUnserializableNodes] = useState<string[]>([]);
  // Tab out of the document hands focus to the details panel's outline; the
  // panel watches this counter the way the editor watches editorFocusRequestId.
  const [outlineFocusRequestId, setOutlineFocusRequestId] = useState(0);

  // The vault's notes: what the link dialog and the "[[" picker offer, and what
  // a clicked link is resolved against. editorProps handlers are created once,
  // so they read the list through a ref that stays current.
  const vaultFilePaths = useAppStore((state) => state.filePaths);
  const vaultFilePathsRef = useRef(vaultFilePaths);
  vaultFilePathsRef.current = vaultFilePaths;

  const fileLinkOptions = useMemo(
    () => (filePath ? buildVaultFileOptions(folderPath, vaultFilePaths, filePath) : []),
    [folderPath, vaultFilePaths, filePath]
  );

  // What the vault agent has proposed for THIS file, if anything. Read from the
  // store rather than passed down: the proposal belongs to the file, not to the
  // component tree above it, and threading it through App and DocumentPanel
  // would only add two more props that mean nothing to either.
  //
  // The marker entry for the open document is filtered out on purpose — those
  // proposals are already ProseMirror widgets in this very editor (see
  // markEditorProposal), and previewing them again would show each change twice.
  const stagedChange = useStagedChangesStore((state) => {
    if (!folderPath || !filePath) {
      return undefined;
    }

    const entry = findStagedChange(
      state.changes,
      normalizeVaultPath(getRelativeDisplayPath(folderPath, filePath))
    );

    return entry && !entry.editorProposal ? entry : undefined;
  });
  const isApplyingStagedChange = useStagedChangesStore((state) => state.isApplying);
  const [stagedPreviewStats, setStagedPreviewStats] = useState<{ hunks: number; missing: number } | null>(
    null
  );

  const ai = useAiEditorActions({ editorRef, markdown, filePath, onAiLoadingChange, onAiPendingChange });
  const { dictation, toggleDictation } = useEditorDictation({
    editorRef,
    setStatus: ai.setAiStatus,
    isDiffActive: ai.isDiffActive,
    isBusyForDictation: ai.isBusyForDictation
  });
  const { contextMenu: selectionMenu, setContextMenu: setSelectionMenu } =
    useContextMenuState<SelectionContextMenuState>();

  // Clipboard failures (a webview without clipboard permission, a browser
  // blocking the API) are reported on the editor's shared feedback channel,
  // no dialog for a copy that did not happen.
  const reportCopyResult = (copied: boolean) => {
    if (!copied) {
      ai.setAiStatus({ kind: "error", message: t("editorContextMenu.copyFailed") });
    }
  };

  const copySelection = (variant: "formatted" | "markdown" | "plainText") => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    if (variant === "formatted") {
      reportCopyResult(copySelectionFormatted(currentEditor));
      return;
    }

    const { from, to } = currentEditor.state.selection;
    holdCopiedImages(currentEditor.state.doc, variant === "markdown" ? { from, to } : null);

    const copy = variant === "markdown" ? copySelectionAsMarkdown : copySelectionAsPlainText;
    void copy(currentEditor).then(reportCopyResult);
  };

  // Right-click on a selection offers the AI rewrite next to the three ways of
  // copying; without a selection there is nothing to copy, so the AI dialog
  // opens directly in insert mode as before.
  const handleEditorContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    // On a touch screen the long press (and on Android the double tap that
    // selects a word) arrives as this event too; it is how a word gets
    // selected there, and our menu would open instead of the selection
    // handles. The paw button in the toolbar is the way in on touch.
    //
    // The event's own pointerType is not enough: Android synthesises the
    // contextmenu of the double tap from the selection, not from the finger,
    // and reports it as a mouse. The last pointer that actually went down in
    // the editor is what decides; only a menu opened without any pointer
    // (keyboard) falls back to the device's primary pointer.
    const nativeEvent = event.nativeEvent as PointerEvent | MouseEvent;
    const eventPointerType = "pointerType" in nativeEvent ? nativeEvent.pointerType : "";
    const pointerType = lastPointerTypeRef.current ?? eventPointerType;
    const isTouchPointer = (type: string) => type === "touch" || type === "pen";
    const fromTouch =
      isTouchPointer(eventPointerType) ||
      isTouchPointer(pointerType) ||
      (pointerType === "" && window.matchMedia("(pointer: coarse)").matches);

    if (fromTouch) {
      return;
    }

    event.preventDefault();

    if (currentEditor.state.selection.empty) {
      ai.openAiDraftFromSelection();
      return;
    }

    setSelectionMenu({ x: event.clientX, y: event.clientY });
  };

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

  // Opening the find panel must work regardless of where the focus currently
  // is (editor, toolbar, sidebar), so that shortcut is registered globally in
  // useGlobalShortcuts rather than in the ProseMirror keymap.

  // The heading goes to the top of the viewport rather than "just visible":
  // the point of a jump is to read the section, not to see its title at the
  // bottom edge.
  const jumpToHeading = (heading: OutlineHeading) => {
    const currentEditor = editorRef.current;

    if (!currentEditor || currentEditor.isDestroyed) {
      return;
    }

    const { doc } = currentEditor.state;
    const node = doc.nodeAt(heading.pos);

    if (!node || node.type.name !== "heading") {
      return;
    }

    // Deliberately does not call .focus(): stealing DOM focus into the editor
    // would pull it out of the outline row, and arrow-key navigation there
    // stops working after the very first jump. Escape / Shift+Tab remain the
    // explicit way back into the document (see onRequestEditorFocus).
    currentEditor.commands.setTextSelection(heading.pos + 1);
    updateOutlineHighlight(currentEditor, heading.pos);

    const element = currentEditor.view.nodeDOM(heading.pos);

    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: "start" });
    }
  };

  const focusEditor = () => {
    const currentEditor = editorRef.current;

    if (currentEditor && !currentEditor.isDestroyed && currentEditor.isEditable) {
      currentEditor.commands.focus();
    }
  };

  const handleLinkRequest = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    const { from, to } = currentEditor.state.selection;

    setLinkDialog({
      href: (currentEditor.getAttributes("link").href as string | undefined) ?? "",
      selectedText: currentEditor.state.doc.textBetween(from, to, " "),
      isLinkActive: currentEditor.isActive("link")
    });
  };

  const handleLinkSubmit = ({ href, text }: LinkDialogResult) => {
    const currentEditor = editorRef.current;
    setLinkDialog(null);

    if (!currentEditor) {
      return;
    }

    // With a selection (or the caret inside an existing link) the document
    // already provides the link text, so only the mark changes. Otherwise the
    // link is inserted with a text of its own: the chosen label, the note's
    // file name, or the URL itself as a last resort.
    if (currentEditor.isActive("link") || !currentEditor.state.selection.empty) {
      currentEditor.chain().focus().extendMarkRange("link").setLink({ href }).run();
      return;
    }

    const label = text || (isFileLinkHref(href) ? getFileLinkLabel(decodeFileLinkHref(href)) : href);

    currentEditor
      .chain()
      .focus()
      .insertContent([{ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }])
      .run();
  };

  const handleLinkRemove = () => {
    setLinkDialog(null);
    editorRef.current?.chain().focus().extendMarkRange("link").unsetLink().run();
  };

  /**
   * Inserts links to other notes of the vault — used by the sidebar drop and
   * by the "[[" picker. `replaceRange` is the typed trigger the chosen link
   * takes the place of; without it the links are inserted at `insertPos`.
   */
  const insertFileLinks = (
    targetFilePaths: string[],
    insertPos: number,
    replaceRange?: { from: number; to: number }
  ) => {
    const currentEditor = editorRef.current;

    if (!currentEditor || targetFilePaths.length === 0) {
      return;
    }

    if (!filePath) {
      ai.setAiStatus({ kind: "error", message: t("editor.linkRequiresFile") });
      return;
    }

    const content = targetFilePaths.flatMap((targetFilePath, index) => {
      const link = {
        type: "text",
        text: getFileLinkLabel(targetFilePath),
        marks: [{ type: "link", attrs: { href: buildFileLinkHref(filePath, targetFilePath) } }]
      };

      return index === 0 ? [link] : [{ type: "text", text: " " }, link];
    });

    currentEditor
      .chain()
      .focus()
      .insertContentAt(replaceRange ?? insertPos, content)
      .run();
  };

  const {
    suggestion: fileLinkSuggestion,
    refreshSuggestion,
    closeSuggestion,
    selectSuggestion,
    setActiveIndex: setSuggestionActiveIndex,
    handleSuggestionKeyDown
  } = useFileLinkSuggestion({
    editorRef,
    fileOptions: fileLinkOptions,
    onSelect: (option: VaultFileOption, range) => {
      insertFileLinks([option.filePath], range.from, range);
    }
  });

  // A link to a note opens that note instead of the browser — routed through
  // App so the unsaved-changes dialog guards the switch, exactly like clicking
  // the file in the sidebar.
  const openFileLink = (href: string) => {
    const targetFilePath = filePath
      ? resolveFileLinkTarget(href, filePath, vaultFilePathsRef.current)
      : null;

    if (!targetFilePath) {
      ai.setAiStatus({
        kind: "error",
        message: t("editor.linkTargetMissing", { href: decodeFileLinkHref(href) })
      });
      return;
    }

    onRequestFileOpen?.(targetFilePath);
  };

  type ImagePayload = { fileName: string; mimeType: string; data: Uint8Array };

  const insertImagePayloads = async (payloads: ImagePayload[], insertPos: number) => {
    const currentEditor = editorRef.current;

    if (!currentEditor || payloads.length === 0) {
      return;
    }

    if (!folderPath || !filePath) {
      ai.setAiStatus({
        kind: "error",
        message: t("editor.imageRequiresFile")
      });
      return;
    }

    // Paste and drop cannot be disabled like a button; refuse up front with
    // the same hint instead of failing per image.
    if (!getVaultCapabilities().images) {
      ai.setAiStatus({ kind: "error", message: vaultCapabilityHint() });
      return;
    }

    let pos = insertPos;

    for (const { fileName, mimeType, data } of payloads) {
      try {
        const rootRelativePath = await saveImageToFolder(folderPath, fileName, mimeType, data);
        const markdownPath = await getRelativeImageMarkdownPath(folderPath, filePath, rootRelativePath);
        const altText = fileName.replace(/\.[^.]+$/, "");

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
          message: t("editor.imageInsertFailed", { fileName, error: extractErrorMessage(error, t) })
        });
      }
    }
  };

  const insertImageFiles = async (files: File[], insertPos: number) => {
    const payloads = await Promise.all(
      files.map(async (file) => ({
        fileName: file.name,
        mimeType: file.type,
        data: new Uint8Array(await file.arrayBuffer())
      }))
    );

    await insertImagePayloads(payloads, insertPos);
  };

  // Toolbar image button: pick one or more image files through the shell's
  // picker (the native dialog opened at the current vault, or the browser's
  // file input), then insert them like a paste/drop.
  const handleImageInsertRequest = async () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    if (!folderPath || !filePath) {
      ai.setAiStatus({
        kind: "error",
        message: t("editor.imageRequiresFile")
      });
      return;
    }

    let picked: PickedImageFile[];

    try {
      picked = await platform.imagePicker.pickImages({
        defaultPath: folderPath ?? getLastOpenedFolderPath() ?? undefined,
        title: t("editor.imageDialogTitle"),
        filterName: t("editor.imageDialogFilter"),
        extensions: EDITOR_IMAGE_EXTENSIONS
      });
    } catch (error) {
      ai.setAiStatus({
        kind: "error",
        message: extractErrorMessage(error, t)
      });
      return;
    }

    if (picked.length === 0) {
      return;
    }

    const payloads: ImagePayload[] = [];

    for (const file of picked) {
      try {
        payloads.push({ fileName: file.fileName, ...(await file.read()) });
      } catch (error) {
        ai.setAiStatus({
          kind: "error",
          message: t("editor.imageInsertFailed", {
            fileName: file.fileName,
            error: extractErrorMessage(error, t)
          })
        });
      }
    }

    await insertImagePayloads(payloads, currentEditor.state.selection.from);
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

  // The note as the .md it is, with what the editor holds right now. Only
  // offered where the file is not on this machine (see markdownDownload).
  const downloadDocument =
    filePath && canDownloadMarkdown(folderPath)
      ? () => {
          const currentEditor = editorRef.current;

          if (!currentEditor) {
            return;
          }

          downloadNoteAsMarkdown(filePath, getEditorMarkdown(currentEditor, markdown)).catch((error: unknown) => {
            console.error("Markdown download failed:", error);
          });
        }
      : null;

  // Serializes the document and returns the markdown only when it is a
  // faithful form of it. Null means the serializer fell back to a placeholder
  // for some node (issue #56: "[table]" for a table with a list in a cell),
  // and the document must not reach the store, let alone the disk, in that
  // form. The banner it raises stays until a later serialization comes back
  // clean.
  const guardSerialization = (currentEditor: TipTapEditor, fallback: string): string | null => {
    const { markdown: serialized, lost } = serializeGuarded(currentEditor, fallback);

    setUnserializableNodes((previous) =>
      previous.length === lost.length && previous.every((name, index) => name === lost[index]) ? previous : lost
    );

    if (lost.length > 0) {
      console.error(`Markdown serialization lost nodes (${lost.join(", ")}); the note is not saved in this state.`);
      return null;
    }

    return serialized;
  };

  // The tools below back the chat agent's document read/edit tool calls (see
  // src/lib/chat/agentTools.ts) — a lookup indirection is needed because the
  // store that drives the agent loop cannot reach into the editor component
  // directly.
  //
  // The three editing tools never touch the document themselves: they open a
  // red/green proposal the user accepts or discards (aiSuggestionWidget.ts),
  // exactly like the "rewrite with AI" review. Several proposals from one
  // agent turn can be open at the same time.
  const getMarkdown = () => {
    const currentEditor = editorRef.current;
    return currentEditor ? getEditorMarkdown(currentEditor, markdown) : "";
  };

  const getSelectionText = () => {
    const currentEditor = editorRef.current;

    return currentEditor ? selectionText(currentEditor) : "";
  };

  const getSelectionRange = (): SelectionRange | null => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return null;
    }

    const { from, to, empty } = currentEditor.state.selection;

    return empty ? null : { from, to };
  };

  const copyRange = (range: SelectionRange, variant: "markdown" | "plainText") => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    holdCopiedImages(currentEditor.state.doc, variant === "markdown" ? range : null);

    const copy = variant === "markdown" ? copySelectionAsMarkdown : copySelectionAsPlainText;
    void copy(currentEditor, range).then(reportCopyResult);
  };

  const syncChatSelection = (currentEditor: TipTapEditor) => {
    useChatStore.getState().setEditorSelection(selectionText(currentEditor));
  };

  // Read straight off the doc rather than by parsing the serialized markdown:
  // the node attribute is the src the editor itself resolves against, so the
  // agent's get_image can never be handed a path the document doesn't have.
  const listImageSources = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return [];
    }

    const sources: string[] = [];

    currentEditor.state.doc.descendants((node) => {
      if (node.type.name !== "image") {
        return;
      }

      const src = (node.attrs.src as string | null) ?? "";

      if (src && !sources.includes(src)) {
        sources.push(src);
      }
    });

    return sources;
  };

  // Bounds for a width the chat agent sets. The lower one matches the drag
  // handles' MIN_IMAGE_WIDTH (see ImageView); the upper one only exists so a
  // model that misreads "a bit bigger" as pixels cannot push the image far off
  // the page.
  const MIN_AI_IMAGE_WIDTH = 48;
  const MAX_AI_IMAGE_WIDTH = 4000;

  // Resizing is the one agent tool that edits the document straight away
  // instead of proposing (see EditorToolBridge in lib/chat/agentTools.ts):
  // the width is a node attribute, so it lands as its own undo step and the
  // user sees the result in the document immediately.
  const setImageWidth = (
    src: string,
    request: { width?: number; scale?: number }
  ): ImageWidthChange | null => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return null;
    }

    const target = normalizeImageSrc(src);
    let position = -1;
    let attrs: Record<string, unknown> | null = null;

    currentEditor.state.doc.descendants((node, pos) => {
      if (position !== -1) {
        return false;
      }

      if (node.type.name === "image" && normalizeImageSrc((node.attrs.src as string | null) ?? "") === target) {
        position = pos;
        attrs = node.attrs;
        return false;
      }

      return true;
    });

    if (position === -1 || attrs === null) {
      return null;
    }

    const currentAttrs = attrs as Record<string, unknown>;

    // Without an explicit width the markdown says nothing about the image's
    // size, so a relative request ("a bit bigger") has no number to work
    // from — the rendered image does. Measuring the NodeView's <img> is what
    // makes the first scale request on an untouched image work at all.
    const renderedDom = currentEditor.view.nodeDOM(position);
    const renderedImage =
      renderedDom instanceof HTMLElement
        ? renderedDom instanceof HTMLImageElement
          ? renderedDom
          : renderedDom.querySelector("img")
        : null;
    const measuredWidth = renderedImage ? Math.round(renderedImage.getBoundingClientRect().width) : null;
    const previousWidth = (currentAttrs.width as number | null) ?? (measuredWidth || null);

    let nextWidth: number | null;

    if (request.width === 0) {
      // Explicit "back to the original size": drop the attribute entirely so
      // the markdown loses its width= title again.
      nextWidth = null;
    } else if (typeof request.width === "number" && request.width > 0) {
      nextWidth = request.width;
    } else if (request.scale && previousWidth) {
      nextWidth = Math.round(previousWidth * request.scale);
    } else {
      return null;
    }

    if (nextWidth !== null) {
      nextWidth = Math.min(MAX_AI_IMAGE_WIDTH, Math.max(MIN_AI_IMAGE_WIDTH, nextWidth));
    }

    currentEditor.view.dispatch(
      currentEditor.state.tr.setNodeMarkup(position, undefined, { ...currentAttrs, width: nextWidth })
    );

    return { src: target, width: nextWidth, previousWidth };
  };

  const createSuggestionId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `suggestion-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Same text, whitespace aside — a model re-proposing a change it believes
  // got lost writes it out again, not byte for byte.
  const isSameProposal = (a: string, b: string) =>
    a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

  const listPendingProposals = (): string[] => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return [];
    }

    return getAiSuggestions(currentEditor).map((suggestion) => {
      const preview = suggestion.replacement.replace(/\s+/g, " ").trim();

      return preview.length > 70 ? `${preview.slice(0, 70)}…` : preview;
    });
  };

  // Both back the chat's accept_proposals/discard_proposals tools: saying
  // "apply that" in the chat has to do the same thing as clicking every
  // widget's button. They return how many proposals they acted on so the tool
  // result can name a number instead of claiming something happened.
  const acceptPendingProposals = (): number => {
    const currentEditor = editorRef.current;

    return currentEditor ? acceptAllAiSuggestions(currentEditor) : 0;
  };

  // Wipes the open proposals without applying any of them. The document is not
  // touched, so this is not an undo step — nothing had been inserted yet.
  const discardPendingProposals = (): number => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return 0;
    }

    const count = getAiSuggestions(currentEditor).length;
    clearAiSuggestions(currentEditor);

    return count;
  };

  const proposeSelectionReplacement = (markdownText: string): ProposalOutcome => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return "failed";
    }

    const { from, to, empty } = currentEditor.state.selection;

    if (empty) {
      return "failed";
    }

    if (duplicatedImageSources(currentEditor.state.doc, markdownText, from, to).length > 0) {
      return "image-duplicate";
    }

    addAiSuggestion(currentEditor, { id: createSuggestionId(), from, to, replacement: markdownText });
    return "proposed";
  };

  const proposeInsertion = (markdownText: string, anchorText?: string): ProposalOutcome => {
    const currentEditor = editorRef.current;

    if (!currentEditor || !markdownText.trim()) {
      return "failed";
    }

    const doc = currentEditor.state.doc;
    // Without an anchor the insertion lands at the caret, which is wherever
    // the user last clicked in the document — see insertAnchor.ts for why a
    // named anchor is the better answer whenever the model has one, and why an
    // anchor is ignored in a document that has nothing to anchor to instead of
    // failing the insertion (a note the user just created).
    const usesAnchor = Boolean(anchorText?.trim()) && hasAnchorableContent(doc);
    const anchor = usesAnchor ? resolveInsertAnchor(doc, anchorText as string) : null;

    if (usesAnchor && anchor === null) {
      return "anchor-not-found";
    }

    // An insertion only ever adds, so *any* image it carries that the document
    // already shows would end up in there twice.
    if (duplicatedImageSources(doc, markdownText, 0, 0).length > 0) {
      return "image-duplicate";
    }

    if (getAiSuggestions(currentEditor).some((open) => isSameProposal(open.replacement, markdownText))) {
      return "duplicate";
    }

    // The anchored insertion that is really a revision: what the model wants
    // put "after" the anchor IS the anchor, rewritten. Proposing it as a
    // replacement of that passage is the only reading that makes sense —
    // inserting it would leave the old wording standing above the new, which
    // is how a reworked poem ended up with every changed line twice.
    //
    // Not an error the model has to correct: its intent is unambiguous here,
    // and bouncing it back would cost a round trip to arrive at exactly this.
    const rewritten = anchor?.range
      ? rewrittenAnchorRange(doc, anchor.range, markdownText)
      : null;

    if (rewritten) {
      addAiSuggestion(currentEditor, {
        id: createSuggestionId(),
        from: rewritten.from,
        to: rewritten.to,
        replacement: markdownText
      });

      return "proposed";
    }

    // Everything being inserted is already in the document, and it is not the
    // anchor rewritten (that was just ruled out above) — the model is
    // rewriting something, but nothing here can tell what. That one goes back
    // with a pointer to replace_passage.
    //
    // Checked whether or not an anchor was given: an anchor only explains a
    // duplicate when the match sits inside it (rewrittenAnchorRange, above). A
    // model that names an anchor elsewhere and re-inserts a passage it already
    // placed in an earlier turn is the same mistake as the unanchored case —
    // this is the bug that duplicated a poem line by line, one accepted
    // proposal at a time.
    if (isDuplicateInsertion(doc, markdownText)) {
      return "text-duplicate";
    }

    // An empty range: nothing gets tinted red, the proposal is purely the new
    // text at that position.
    const from = anchor ? anchor.position : currentEditor.state.selection.from;

    addAiSuggestion(currentEditor, { id: createSuggestionId(), from, to: from, replacement: markdownText });
    return "proposed";
  };

  const proposePassageReplacement = (oldText: string, newText: string): ProposalOutcome => {
    const currentEditor = editorRef.current;

    if (!currentEditor || !oldText) {
      return "failed";
    }

    const doc = currentEditor.state.doc;
    const open = getAiSuggestions(currentEditor);

    // A passage can occur several times, and one agent turn can propose a
    // change for each occurrence — so skip past matches that already carry a
    // proposal instead of stacking them all on the first hit. An occurrence
    // whose open proposal says the same thing is not a further occurrence
    // though: that is the model proposing its own change a second time.
    let searchFrom = 0;
    let found = findTextRange(doc, searchFrom, doc.content.size, oldText);

    while (found) {
      const overlapping = open.filter(
        (suggestion) => suggestion.from < found!.to && found!.from < suggestion.to
      );

      if (overlapping.length === 0) {
        break;
      }

      if (overlapping.some((suggestion) => isSameProposal(suggestion.replacement, newText))) {
        return "duplicate";
      }

      searchFrom = found.to;
      // Exact matches only from here on: a *further* occurrence has to be the
      // same passage again, and an approximate one would put the change on
      // whatever else in the document happens to read similarly.
      found =
        searchFrom < doc.content.size
          ? findTextRange(doc, searchFrom, doc.content.size, oldText, { fuzzy: false })
          : null;
    }

    if (!found) {
      return "not-found";
    }

    if (duplicatedImageSources(doc, newText, found.from, found.to).length > 0) {
      return "image-duplicate";
    }

    addAiSuggestion(currentEditor, {
      id: createSuggestionId(),
      from: found.from,
      to: found.to,
      replacement: newText
    });
    return "proposed";
  };

  useImperativeHandle(
    ref,
    () => ({
      cancelAiRequest: ai.cancelAiRequest,
      printDocument,
      getMarkdown,
      getSelectionText,
      getSelectionRange,
      copyRange,
      listImageSources,
      listPendingProposals,
      acceptPendingProposals,
      discardPendingProposals,
      proposeSelectionReplacement,
      proposeInsertion,
      proposePassageReplacement,
      setImageWidth
    }),
    [ai, markdown]
  );

  // The file's markdown goes into the editor verbatim: normalizing it here
  // (e.g. unescaping "\[ \]" into a real checkbox) rewrites the document
  // against what's on disk, and the file shows up as unsaved the moment it is
  // opened. AI output is normalized where it enters the document instead —
  // see useAiEditorActions and lib/chat/agentTools.
  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content: markdown,
    editable: true,
    // editorRef is assigned during render (below), not here: under
    // React.StrictMode useEditor creates a second instance and discards the
    // first, and the first one's deferred onCreate would put the destroyed
    // instance back into the ref until the next render.
    onCreate: () => {
      lastSyncedMarkdownRef.current = markdown;
    },
    onUpdate: ({ editor, transaction }) => {
      const nextMarkdown = guardSerialization(editor, markdown);

      if (nextMarkdown === null) {
        // The store keeps the last good form; the banner asks the user to
        // undo. The rest of the update (selection mirror, suggestions) is
        // unaffected.
        syncChatSelection(editor);
        refreshSuggestion();
        return;
      }

      lastSyncedMarkdownRef.current = nextMarkdown;

      // A document change that only an appended transaction made is not an
      // edit: StarterKit's TrailingNode adds an empty paragraph after a
      // closing code block (or table, image) on the first transaction after
      // the file opens, which a plugin fires right at mount. Reported as an
      // edit it made every such note "unsaved" the moment it was opened,
      // since the baseline still had the file's own form. It is formatting,
      // so it goes to the baseline first, the way the sync effect below
      // reports the canonical form; a note with real unsaved edits keeps
      // them (adoptCanonicalFileContent leaves a dirty document alone).
      if (!transaction.docChanged && filePath) {
        onCanonicalMarkdownRef.current?.(filePath, nextMarkdown);
      }

      onMarkdownChange(nextMarkdown);

      // An edit can change what the selection covers without the selection
      // itself moving, so the mirror is refreshed from here too.
      syncChatSelection(editor);
      refreshSuggestion();
    },
    // The chat composer shows the selected passage and sends it as context with
    // the next message (see src/store/useChatStore.ts), which needs the live
    // selection rather than a lookup at send time.
    onSelectionUpdate: ({ editor }) => {
      syncChatSelection(editor);
      refreshSuggestion();
    },
    onBlur: ({ editor: currentEditor }) => {
      closeSuggestion();
      // A selected image stays selected when the editor loses focus, so a click
      // outside would leave it highlighted with its resize handles.
      collapseNodeSelection(currentEditor);
    },
    // Real focus in the editor means the reader is looking at the caret, not
    // hunting for a section anymore — whichever of the several ways back in
    // they used (click, Escape, Shift+Tab).
    onFocus: ({ editor: currentEditor }) => {
      updateOutlineHighlight(currentEditor, null);
    },
    editorProps: {
      handleDrop: (view, event, _slice, moved) => {
        if (moved) {
          return false;
        }

        const droppedAt = () => {
          const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
          return coordinates?.pos ?? view.state.selection.from;
        };

        // Notes dragged out of the sidebar become links, images dragged in from
        // outside the app are embedded.
        const draggedFilePaths = getDraggedVaultFilePaths(event.dataTransfer);

        if (draggedFilePaths.length > 0) {
          event.preventDefault();
          insertFileLinks(draggedFilePaths, droppedAt());
          return true;
        }

        const files = getImageFilesFromDataTransfer(event.dataTransfer);

        // Documents are deliberately not converted into the open text: they
        // belong in the vault as their own note, so the drop is refused with a
        // pointer to the file list rather than pasting a PDF into a sentence.
        if (getNonImageFilesFromDataTransfer(event.dataTransfer).length > 0) {
          event.preventDefault();
          ai.setAiStatus({ kind: "error", message: t("editor.dropDocumentHint") });

          if (files.length === 0) {
            return true;
          }
        }

        if (files.length === 0) {
          return false;
        }

        event.preventDefault();
        void insertImageFiles(files, droppedAt());

        return true;
      },
      transformPasted: (slice) => {
        const normalized = normalizePastedSlice(slice);

        if (!pastingRef.current) {
          return normalized;
        }

        const { selectedFilePath, folderPath: vaultPath } = useAppStore.getState();
        return adoptPastedImages(normalized, selectedFilePath, vaultPath);
      },
      handlePaste: (view, event) => {
        const plainPasteRequested = plainPasteRequestedRef.current;
        plainPasteRequestedRef.current = false;

        const files = getImageFilesFromClipboard(event.clipboardData);

        if (files.length > 0) {
          event.preventDefault();

          void insertImageFiles(files, view.state.selection.from);
          return true;
        }

        // Plain text that reads as Markdown is pasted as what it describes.
        // Not when the clipboard also carries HTML (a copy out of a browser
        // or Word, which ProseMirror already parses — a "*" in that text is
        // a character, not emphasis), not into a code block, and not when
        // the user asked for the raw text with Ctrl+Shift+V.
        const currentEditor = editorRef.current;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const hasHtml = Boolean(event.clipboardData?.getData("text/html"));
        const inCode = view.state.selection.$from.parent.type.spec.code === true;

        if (
          plainPasteRequested ||
          hasHtml ||
          inCode ||
          !currentEditor ||
          !useEditorSettingsStore.getState().pasteMarkdown ||
          !looksLikeMarkdown(text)
        ) {
          return false;
        }

        const { selectedFilePath, folderPath: vaultPath } = useAppStore.getState();

        if (!pasteMarkdown(currentEditor, text, (slice) => adoptPastedImages(slice, selectedFilePath, vaultPath))) {
          return false;
        }

        event.preventDefault();
        return true;
      },
      handleDOMEvents: {
        // Ctrl+C/Ctrl+X, the system menu and "copy with formatting" all end
        // in the native event; ProseMirror still writes the clipboard itself.
        // With nothing selected nothing is copied, and the clipboard (with
        // the images it may hold) stays what it was.
        copy: (view) => {
          if (!view.state.selection.empty) {
            holdCopiedImages(view.state.doc, view.state.selection);
          }

          return false;
        },
        cut: (view) => {
          if (!view.state.selection.empty) {
            holdCopiedImages(view.state.doc, view.state.selection);
          }

          return false;
        },
        // ProseMirror parses the clipboard in the same listener, right after
        // this, so the flag is only up for that one synchronous run.
        paste: () => {
          pastingRef.current = true;
          queueMicrotask(() => {
            pastingRef.current = false;
          });

          return false;
        },
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;

          if (!anchor) {
            // A URL inside a code block is plain text carrying a decoration
            // (src/lib/editor/codeBlockLinks.ts), not an <a>: it opens in the
            // browser like any other external link.
            const codeLink = target?.closest(`[${CODE_LINK_ATTR}]`)?.getAttribute(CODE_LINK_ATTR);

            if (!codeLink) {
              return false;
            }

            event.preventDefault();
            void platform.shell.openUrl(codeLink);
            return true;
          }

          event.preventDefault();

          // A plain click follows the link — a note opens in the editor, any
          // other target in the system browser. The raw attribute is what a
          // note link has to be resolved from: the DOM property would resolve
          // the relative path against the app's own base URL.
          const rawHref = anchor.getAttribute("href") ?? "";

          if (isFileLinkHref(rawHref)) {
            openFileLink(rawHref);
          } else {
            void platform.shell.openUrl(anchor.href);
          }

          return true;
        }
      },
      handleKeyDown: (view, event) => {
        // While the "[[" picker is open it owns the arrow keys, Enter, Tab and
        // Escape — nothing of that may reach the document.
        if (handleSuggestionKeyDown(event)) {
          return true;
        }

        if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          // Where Tab already means something (indent in lists and code, next
          // cell in tables) it stays with the extensions' keymaps; only outside
          // does it move focus: Shift+Tab to the sidebar, Tab to the details
          // panel's outline. Sidebar, document, outline: one direction, left
          // to right.
          const currentEditor = editorRef.current;
          const tabHasMeaning =
            currentEditor?.isActive("bulletList") ||
            currentEditor?.isActive("orderedList") ||
            currentEditor?.isActive("taskList") ||
            currentEditor?.isActive("table") ||
            currentEditor?.isActive("codeBlock");

          if (tabHasMeaning) {
            return false;
          }

          if (event.shiftKey) {
            event.preventDefault();
            onRequestSidebarFocus?.();
            return true;
          }

          // With nothing to land on, Tab keeps today's behaviour rather than
          // becoming a dead key. The panel is checked in the DOM, not the
          // store: Zen mode and narrow windows hide it with CSS while it
          // stays mounted, and a hidden button cannot take focus.
          const panel = view.dom.closest(".editor-view")?.querySelector<HTMLElement>(".details-sidebar");

          if (!panel || panel.offsetParent === null || !hasHeading(view.state.doc)) {
            return false;
          }

          event.preventDefault();
          setOutlineFocusRequestId((id) => id + 1);
          return true;
        }

        if (!couldBeShortcut(event)) {
          return false;
        }

        // The copy combos are fixed on purpose (lib/shortcuts/fixed.ts), so
        // they are settled before the remappable registry gets a look. Only
        // a selection is copied: with nothing selected the keystrokes stay
        // with the browser, which keeps Ctrl+C native in every other focus.
        const fixedShortcut = matchFixedEditorShortcut(event);

        if (fixedShortcut === "pastePlainText") {
          // The keystroke stays with the browser, which pastes the plain
          // text; the flag only tells handlePaste to skip the Markdown
          // conversion. Cleared shortly after in case no paste follows
          // (empty clipboard, permission refused).
          plainPasteRequestedRef.current = true;
          window.setTimeout(() => {
            plainPasteRequestedRef.current = false;
          }, 500);

          return false;
        }

        if (fixedShortcut) {
          if (view.state.selection.empty || fixedShortcut === "copyFormatted") {
            return false;
          }

          event.preventDefault();
          copySelection(fixedShortcut === "copyMarkdown" ? "markdown" : "plainText");
          return true;
        }

        // Everything below is user-remappable, so the combo is looked up
        // instead of compared inline. getState() keeps a rebind effective
        // without recreating the editor.
        const { overrides } = useShortcutsStore.getState();
        const action = matchShortcut(overrides, event, "editor");

        if (!action) {
          // A default the user moved elsewhere must not silently fall through
          // to TipTap's own keymap (Ctrl+B, Ctrl+I, Ctrl+U, …).
          if (isRetiredDefault(overrides, event, "editor")) {
            event.preventDefault();
            return true;
          }

          return false;
        }

        const chain = () => editorRef.current?.chain().focus();

        switch (action) {
          case "moveListItemUp":
          case "moveListItemDown": {
            const direction = action === "moveListItemUp" ? "up" : "down";
            const moved = moveListItem(view, direction) || moveLine(view, direction);

            if (moved) {
              event.preventDefault();
            }

            return moved;
          }
          case "aiCheckDialog":
            event.preventDefault();
            ai.runAiGrammarCheck();

            return true;
          case "checkboxToggle":
            event.preventDefault();
            toggleTaskItemChecked(view);
            return true;
          default:
            break;
        }

        event.preventDefault();

        switch (action) {
          case "bold":
            chain()?.toggleBold().run();
            break;
          case "italic":
            chain()?.toggleItalic().run();
            break;
          case "underline":
            chain()?.toggleUnderline().run();
            break;
          case "highlight":
            // With a selection the combo is a plain format toggle; without one
            // it switches the marker tool, so the keyboard reaches the same
            // two behaviours as the toolbar button.
            if (view.state.selection.empty) {
              chain()?.toggleHighlighterMode().run();
            } else {
              chain()?.toggleHighlight().run();
            }
            break;
          case "strikethrough":
            chain()?.toggleStrike().run();
            break;
          case "inlineCode":
            chain()?.toggleCode().run();
            break;
          case "codeBlock":
            chain()?.toggleCodeBlock().run();
            break;
          case "blockquote":
            chain()?.toggleBlockquote().run();
            break;
          case "insertLink":
            handleLinkRequest();
            break;
          case "bulletList":
            chain()?.toggleBulletList().run();
            break;
          case "orderedList":
            chain()?.toggleOrderedList().run();
            break;
          case "checkbox":
            chain()?.toggleTaskList().run();
            break;
          case "heading1":
          case "heading2":
          case "heading3":
          case "heading4":
          case "heading5":
          case "heading6": {
            const level = Number(action.slice(-1)) as 1 | 2 | 3 | 4 | 5 | 6;
            chain()?.toggleHeading({ level }).run();
            break;
          }
          case "aiVoiceDialog":
            // Opens the AI dialog and immediately starts voice input into the
            // prompt field (issue #7).
            ai.setVoiceStartRequestId((id) => id + 1);
            ai.openAiDraftFromSelection();
            break;
          case "aiEditDialog":
            ai.openAiDraftFromSelection();
            break;
          case "dictation":
            toggleDictation();
            break;
          default:
            break;
        }

        return true;
      },
      attributes: {
        class: cn(
          "editor-view__surface prose dark:prose-invert max-w-none",
          paperSurface && PAPER_SURFACE_CLASS
        ),
        "data-testid": "editor",
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

  useEffect(() => {
    editor?.view.dom.classList.toggle(PAPER_SURFACE_CLASS, paperSurface);
  }, [editor, paperSurface]);

  // A tap on an image selects it without focusing the editor (see ImageView),
  // so there is no blur to clear that selection on. A pointer going down
  // anywhere outside the editor surface clears it instead.
  useEffect(() => {
    if (!editor) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (target && !editor.view.dom.contains(target)) {
        collapseNodeSelection(editor);
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [editor]);

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

  // Runs *before* the staged-preview effect below on purpose: effects fire in
  // declaration order, so a preview added first would be wiped by this clear on
  // the very mount that opened the file.
  // Pending chat proposals are anchored to positions in *this* document —
  // switching files (or having the content replaced from outside) would leave
  // them pointing at unrelated text, so they're dropped up front.
  useEffect(() => {
    const currentEditor = editorRef.current;

    if (currentEditor && !currentEditor.isDestroyed) {
      clearAiSuggestions(currentEditor);
    }
  }, [filePath]);

  const stagedRelativePath =
    folderPath && filePath ? normalizeVaultPath(getRelativeDisplayPath(folderPath, filePath)) : "";


  useEffect(() => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    if (
      markdown !== lastSyncedMarkdownRef.current &&
      markdown !== getEditorMarkdown(currentEditor, "")
    ) {
      currentEditor.commands.setContent(markdown, { emitUpdate: false });
    }

    lastSyncedMarkdownRef.current = markdown;

    // A file whose content the serializer can't write back must not have
    // its baseline replaced by the placeholder form either.
    const canonicalMarkdown = guardSerialization(currentEditor, markdown);

    if (canonicalMarkdown === null) {
      return;
    }

    // The same document can be written in several equivalent ways, and the
    // editor always serializes the canonical one — so markdown that is valid
    // but formatted differently (loose lists, "*" bullets, "1)" numbering)
    // comes back changed on the very first serialization, with no edit
    // involved. Reporting that form back as the baseline is what keeps a
    // freshly opened file from showing up as unsaved; nothing is written to
    // disk here.
    if (filePath && canonicalMarkdown !== markdown) {
      lastSyncedMarkdownRef.current = canonicalMarkdown;
      onCanonicalMarkdownRef.current?.(filePath, canonicalMarkdown);
    }
  }, [markdown, editor, filePath]);

  // Declared last on purpose. Every effect above can still move the document
  // out from under a proposal on the very mount that opens the file — the
  // filePath effect clears the suggestion list, and the sync effect above may
  // call setContent, which replaces the doc the positions were computed
  // against. Running after both means the document is settled before the
  // preview is built; before them the preview was added and then silently
  // wiped, so the change only appeared once the user left the file and came
  // back.
  // Renders a staged file change as the familiar red/green review, and locks the
  // document while it is on screen.
  //
  // The lock is the load-bearing part. The proposal was computed against the
  // file's content as the agent read it; letting the user type underneath it
  // would drift the document away from that baseline, and applying the change
  // afterwards would overwrite their words without either side noticing.
  useEffect(() => {
    const currentEditor = editorRef.current;


    if (!currentEditor || currentEditor.isDestroyed) {
      return;
    }

    // The lock is toggled without TipTap's update event (the second argument):
    // by default setEditable reports an "update", which onUpdate above turns
    // into a document edit. Locking is not an edit, and reporting one here
    // pushes whatever the editor holds at that moment into the store as the
    // user's text. Applying a proposal is where that showed: the store had
    // just been given the applied content, the editor still held the
    // baseline, and the "edit" made the freshly written note dirty.
    if (!stagedChange) {
      setAiSuggestionOverride(currentEditor, null);
      currentEditor.setEditable(true, false);
      setStagedPreviewStats(null);
      return;
    }

    currentEditor.setEditable(false, false);

    // The review's own accept/discard buttons belong to the chat agent's
    // proposals, where they edit the document. A staged change is not a
    // document edit — it has to be applied through the staging layer, or the
    // entry survives the accept and the review is rebuilt from it: the text
    // ends up in the document a second time and the green block stays.
    setAiSuggestionOverride(currentEditor, {
      onAccept: () => void useStagedChangesStore.getState().applyOne(stagedRelativePath),
      onDiscard: () => void useStagedChangesStore.getState().discardOne(stagedRelativePath)
    });

    const kind = stagedChangeKind(stagedChange);

    // A deletion or a plain rename changes no text, so there is no diff to
    // show — the bar says what is proposed, and the lock keeps the file from
    // drifting away from the baseline the entry was built on.
    if (kind === "delete" || kind === "rename") {
      setStagedPreviewStats({ hunks: 0, missing: 0 });

      return () => {
        if (!currentEditor.isDestroyed) {
          setAiSuggestionOverride(currentEditor, null);
          currentEditor.setEditable(true, false);
        }
      };
    }

    clearAiSuggestions(currentEditor);

    const preview = buildStagedPreview(
      currentEditor.state.doc,
      stagedChange.baseContent ?? "",
      stagedChange.content ?? ""
    );

    for (const suggestion of preview.suggestions) {
      addAiSuggestion(currentEditor, { id: createSuggestionId(), ...suggestion });
    }

    setStagedPreviewStats({ hunks: preview.suggestions.length, missing: preview.missing });


    return () => {

      if (!currentEditor.isDestroyed) {
        setAiSuggestionOverride(currentEditor, null);
        clearAiSuggestions(currentEditor);
        currentEditor.setEditable(true, false);
      }
    };
  }, [stagedChange, editor, markdown, stagedRelativePath]);

  if (!editor) {
    return null;
  }

  const toolbar = (
    <Toolbar
      editor={editor}
      onLinkRequest={handleLinkRequest}
      onImageInsertRequest={handleImageInsertRequest}
      onAiRequest={ai.openAiDraftFromSelection}
      onAiCheckRequest={ai.runAiGrammarCheck}
      onAiSettingsRequest={onAiSettingsRequest}
      onPrintRequest={printDocument}
      onDownloadMarkdownRequest={downloadDocument}
      onSearchRequest={openFindPanel}
      onZenModeRequest={onZenModeRequest}
    />
  );

  return (
    <div className="editor-view">
      {stagedChange ? (
        <StagedChangeBar
          change={stagedChange}
          hunkCount={stagedPreviewStats?.hunks ?? 0}
          missingHunks={stagedPreviewStats?.missing ?? 0}
          isApplying={isApplyingStagedChange}
          onAccept={() => void useStagedChangesStore.getState().applyOne(stagedRelativePath)}
          onDiscard={() => void useStagedChangesStore.getState().discardOne(stagedRelativePath)}
        />
      ) : null}

      {dictation.status === "recording" || dictation.status === "transcribing" ? (
        <VoiceRecordingBanner
          level={dictation.level}
          isRecording={dictation.status === "recording"}
          message={dictation.status === "recording" ? t("voice.editorRecordingHint") : t("voice.transcribing")}
        />
      ) : null}

      {unserializableNodes.length > 0 ? (
        <div className="editor-view__feedback editor-view__feedback--error" role="alert">
          <span className="editor-view__feedback-message">
            {t("editor.unserializableContent", { nodes: unserializableNodes.join(", ") })}
          </span>
        </div>
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
          <button
            type="button"
            className="editor-view__feedback-dismiss"
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={() => ai.setAiStatus(null)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {toolbarContainer ? createPortal(toolbar, toolbarContainer) : toolbar}

      <EditorFileContext.Provider value={{ folderPath, filePath }}>
        <div className="editor-view__body">
          <FindReplacePanel
            editor={editor}
            folderPath={folderPath}
            filePath={filePath}
            onClose={closeFindPanel}
            onRequestFileOpen={onRequestFileOpen}
          />
          <div className="editor-view__panes">
            <ScrollArea className="editor-view__scroll">
              <EditorContent
                editor={editor}
                className="editor-view__content"
                onPointerDownCapture={(event) => {
                  lastPointerTypeRef.current = event.pointerType;
                }}
                onContextMenu={handleEditorContextMenu}
                // The wrapper fills the scroll area below a short document.
                // A click there is outside the contenteditable, so left to
                // itself the browser parks the DOM selection on the nearest
                // selectable element before it, the toolbar's separator,
                // which then lights up as a stray caret. Treat it as "after
                // the last paragraph" instead, the way editors do.
                onMouseDown={(event) => {
                  if (event.target !== event.currentTarget || !editor) {
                    return;
                  }

                  event.preventDefault();
                  editor.commands.focus("end");
                }}
              />
            </ScrollArea>

            {detailsSheetOpen && layout !== "desktop" && !isChatOpen ? (
              <MobileSheet
                side={layout === "phone" ? "full" : "right"}
                backdrop={layout === "phone"}
                label={t("detailsPanel.title")}
                onClose={() => setDetailsSheetOpen(false)}
                className="mobile-sheet__panel--details"
              >
                <DetailsPanel
                  editor={editor}
                  folderPath={folderPath}
                  filePath={filePath}
                  markdown={markdown}
                  vaultFilePaths={vaultFilePaths}
                  outlineFocusRequestId={outlineFocusRequestId}
                  onJumpToHeading={jumpToHeading}
                  onRequestEditorFocus={focusEditor}
                  onRequestFileOpen={onRequestFileOpen}
                  onClose={() => setDetailsSheetOpen(false)}
                  width={detailsPanelWidth}
                />
              </MobileSheet>
            ) : null}

            {detailsPanelVisible && layout === "desktop" ? (
              <>
                <div
                  className={cn(
                    "workspace-resizer",
                    isResizingDetailsPanel && "workspace-resizer--active"
                  )}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t("detailsPanel.resizeLabel")}
                  aria-valuenow={detailsPanelWidth}
                  aria-valuemin={DETAILS_PANEL_MIN_WIDTH}
                  aria-valuemax={DETAILS_PANEL_MAX_WIDTH}
                  tabIndex={0}
                  onPointerDown={handleDetailsPanelResizeStart}
                  onKeyDown={handleDetailsPanelResizeKeyDown}
                >
                  <span className="workspace-resizer__grip" aria-hidden="true" />
                </div>
                <DetailsPanel
                  editor={editor}
                  folderPath={folderPath}
                  filePath={filePath}
                  markdown={markdown}
                  vaultFilePaths={vaultFilePaths}
                  outlineFocusRequestId={outlineFocusRequestId}
                  onJumpToHeading={jumpToHeading}
                  onRequestEditorFocus={focusEditor}
                  onRequestFileOpen={onRequestFileOpen}
                  onClose={() => setDetailsPanelVisible(false)}
                  width={detailsPanelWidth}
                />
              </>
            ) : null}
          </div>
        </div>
      </EditorFileContext.Provider>

      {fileLinkSuggestion ? (
        <FileLinkSuggestionPopover
          suggestion={fileLinkSuggestion}
          onSelect={selectSuggestion}
          onActiveIndexChange={setSuggestionActiveIndex}
        />
      ) : null}

      <LinkDialog
        open={linkDialog !== null}
        initialHref={linkDialog?.href ?? ""}
        selectedText={linkDialog?.selectedText ?? ""}
        isLinkActive={linkDialog?.isLinkActive ?? false}
        fileOptions={fileLinkOptions}
        currentFilePath={filePath}
        onSubmit={handleLinkSubmit}
        onRemove={handleLinkRemove}
        onCancel={() => setLinkDialog(null)}
      />

      {selectionMenu ? (
        <SelectionContextMenu
          x={selectionMenu.x}
          y={selectionMenu.y}
          canAiEdit={Boolean(editor?.isEditable) && !ai.isDiffActive()}
          onAiEdit={ai.openAiDraftFromSelection}
          onCopyFormatted={() => copySelection("formatted")}
          onCopyMarkdown={() => copySelection("markdown")}
          onCopyPlainText={() => copySelection("plainText")}
          onClose={() => setSelectionMenu(null)}
        />
      ) : null}

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