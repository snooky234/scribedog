import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { EditorContent, type Editor as TipTapEditor, useEditor } from "@tiptap/react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { AiCheckDialog } from "@/components/AiCheckDialog";
import { FindReplacePanel } from "@/components/FindReplacePanel";
import { AiRewriteDialog } from "@/components/AiRewriteDialog";
import { LinkDialog, type LinkDialogResult } from "@/components/LinkDialog";
import { VoiceModelDownloadDialog } from "@/components/VoiceModelDownloadDialog";
import { VoiceRecordingBanner } from "@/components/VoiceRecordingBanner";
import { Toolbar } from "@/components/Toolbar";
import { FileLinkSuggestionPopover } from "@/components/editor/FileLinkSuggestionPopover";
import { DetailsPanel } from "@/components/editor/DetailsPanel";
import { useAiEditorActions } from "@/components/editor/useAiEditorActions";
import { useEditorDictation } from "@/components/editor/useEditorDictation";
import { useFileLinkSuggestion } from "@/components/editor/useFileLinkSuggestion";
import {
  acceptAllAiSuggestions,
  addAiSuggestion,
  clearAiSuggestions,
  getAiSuggestions
} from "@/lib/aiSuggestionWidget";
import type { ImageWidthChange, ProposalOutcome } from "@/lib/chat/agentTools";
import { normalizeImageSrc } from "@/lib/chat/imageAttachments";
import { EditorFileContext } from "@/lib/editorFileContext";
import { buildEditorExtensions } from "@/lib/editor/extensions";
import { duplicatedImageSources } from "@/lib/editor/documentImages";
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
import { moveListItem, toggleTaskItemChecked } from "@/lib/editor/listCommands";
import { normalizeEscapedCheckboxes } from "@/lib/editor/markdownNormalize";
import { getEditorMarkdown, getSelectionMarkdown } from "@/lib/editor/markdownStorage";
import { findTextRange } from "@/lib/editor/textSearch";
import {
  allowFileAccess,
  getLastOpenedFolderPath,
  getRelativeImageMarkdownPath,
  guessImageMimeType,
  saveImageToFolder
} from "@/lib/fileSystem";
import { updateSearchHighlight } from "@/lib/searchHighlight";
import { printMarkdown } from "@/lib/print";
import { couldBeShortcut } from "@/lib/shortcuts/binding";
import { isRetiredDefault, matchShortcut } from "@/lib/shortcuts/resolve";
import { useAppStore } from "@/store/useAppStore";
import { useChatStore } from "@/store/useChatStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";
import { useShortcutsStore } from "@/store/useShortcutsStore";

// What the editor embeds as an image — the toolbar's file filter and the drop
// handler share this list, so both accept exactly the same files.
const EDITOR_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

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
};

export type EditorHandle = {
  cancelAiRequest: () => void;
  printDocument: () => void;
  getMarkdown: () => string;
  getSelectionText: () => string;
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
    onZenModeRequest
  },
  ref
) {
  const { t } = useTranslation();
  const editorRef = useRef<TipTapEditor | null>(null);
  const lastSyncedMarkdownRef = useRef(markdown);
  const spellcheckEnabled = useEditorSettingsStore((state) => state.spellcheckEnabled);
  const detailsPanelVisible = useEditorSettingsStore((state) => state.detailsPanelVisible);
  const setDetailsPanelVisible = useEditorSettingsStore((state) => state.setDetailsPanelVisible);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);

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

  // Opening the find panel must work regardless of where the focus currently
  // is (editor, toolbar, sidebar), so that shortcut is registered globally in
  // useGlobalShortcuts rather than in the ProseMirror keymap.

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

  const readImagePayload = async (path: string): Promise<ImagePayload> => {
    await allowFileAccess(path);

    return {
      fileName: path.replace(/\\/g, "/").split("/").pop() ?? "image",
      mimeType: guessImageMimeType(path),
      data: await readFile(path)
    };
  };

  // Toolbar image button: pick one or more image files via the native file
  // dialog, opened at the currently open vault (falling back to the last
  // opened folder), then insert them like a paste/drop.
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

    let selection: string | string[] | null;

    try {
      selection = await open({
        multiple: true,
        directory: false,
        defaultPath: folderPath ?? getLastOpenedFolderPath() ?? undefined,
        title: t("editor.imageDialogTitle"),
        filters: [
          {
            name: t("editor.imageDialogFilter"),
            extensions: EDITOR_IMAGE_EXTENSIONS
          }
        ]
      });
    } catch (error) {
      ai.setAiStatus({
        kind: "error",
        message: extractErrorMessage(error, t)
      });
      return;
    }

    const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];

    if (paths.length === 0) {
      return;
    }

    const payloads: ImagePayload[] = [];

    for (const path of paths) {
      try {
        payloads.push(await readImagePayload(path));
      } catch (error) {
        ai.setAiStatus({
          kind: "error",
          message: t("editor.imageInsertFailed", {
            fileName: path.replace(/\\/g, "/").split("/").pop() ?? path,
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

    // An empty range: nothing gets tinted red, the proposal is purely the new
    // text at that position.
    const from = anchor ?? currentEditor.state.selection.from;

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
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      lastSyncedMarkdownRef.current = markdown;
    },
    onUpdate: ({ editor }) => {
      const nextMarkdown = getEditorMarkdown(editor, markdown);
      lastSyncedMarkdownRef.current = nextMarkdown;

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
    onBlur: () => {
      closeSuggestion();
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

          // A plain click follows the link — a note opens in the editor, any
          // other target in the system browser. The raw attribute is what a
          // note link has to be resolved from: the DOM property would resolve
          // the relative path against the app's own base URL.
          const rawHref = anchor.getAttribute("href") ?? "";

          if (isFileLinkHref(rawHref)) {
            openFileLink(rawHref);
          } else {
            void openUrl(anchor.href);
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

        if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey) {
          // Inside a list, Shift+Tab decreases the indent (handled by the
          // list extensions' keymap); only outside a list does it move focus
          // to the sidebar.
          const currentEditor = editorRef.current;
          const inList =
            currentEditor?.isActive("bulletList") ||
            currentEditor?.isActive("orderedList") ||
            currentEditor?.isActive("taskList");

          if (inList) {
            return false;
          }

          event.preventDefault();
          onRequestSidebarFocus?.();
          return true;
        }

        if (!couldBeShortcut(event)) {
          return false;
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
            const moved = moveListItem(view, action === "moveListItemUp" ? "up" : "down");

            if (moved) {
              event.preventDefault();
            }

            return moved;
          }
          case "aiCheckDialog":
            // Without a selection there is nothing to check, but the combo is
            // still consumed so it never reaches the document.
            if (!view.state.selection.empty) {
              event.preventDefault();
              ai.runAiGrammarCheck();
            }

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

  // Pending chat proposals are anchored to positions in *this* document —
  // switching files (or having the content replaced from outside) would leave
  // them pointing at unrelated text, so they're dropped up front.
  useEffect(() => {
    const currentEditor = editorRef.current;

    if (currentEditor && !currentEditor.isDestroyed) {
      clearAiSuggestions(currentEditor);
    }
  }, [filePath]);

  // Kept in a ref so the sync effect below doesn't re-run for a new callback
  // identity — it may only react to actual content changes.
  const onCanonicalMarkdownRef = useRef(onCanonicalMarkdown);
  onCanonicalMarkdownRef.current = onCanonicalMarkdown;

  useEffect(() => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    let canonicalMarkdown = getEditorMarkdown(currentEditor, "");

    if (markdown !== lastSyncedMarkdownRef.current && markdown !== canonicalMarkdown) {
      currentEditor.commands.setContent(markdown, { emitUpdate: false });
      canonicalMarkdown = getEditorMarkdown(currentEditor, markdown);
    }

    lastSyncedMarkdownRef.current = markdown;

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
        onImageInsertRequest={handleImageInsertRequest}
        onAiRequest={ai.openAiDraftFromSelection}
        onAiCheckRequest={ai.runAiGrammarCheck}
        onAiSettingsRequest={onAiSettingsRequest}
        onPrintRequest={printDocument}
        onSearchRequest={openFindPanel}
        onZenModeRequest={onZenModeRequest}
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
          <div className="editor-view__panes">
            <ScrollArea className="editor-view__scroll">
              <EditorContent
                editor={editor}
                className="editor-view__content"
                onContextMenu={ai.handleAiContextMenu}
              />
            </ScrollArea>

            {detailsPanelVisible ? (
              <DetailsPanel
                folderPath={folderPath}
                filePath={filePath}
                markdown={markdown}
                vaultFilePaths={vaultFilePaths}
                onRequestFileOpen={onRequestFileOpen}
                onClose={() => setDetailsPanelVisible(false)}
              />
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