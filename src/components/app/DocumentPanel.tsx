import { Fragment, useState, type RefObject } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  FolderOpen,
  Loader2,
  PanelLeft,
  Pencil,
  Save,
  Square
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Editor, type EditorHandle } from "@/components/Editor";
import { FindReplacePanel } from "@/components/FindReplacePanel";
import { VersionsPopover } from "@/components/VersionsPopover";
import { DocumentMenu } from "@/components/app/DocumentMenu";
import { join } from "@/platform/paths";
import { EmojiPickerPopover } from "@/components/EmojiPicker";
import { useBreadcrumbScroll } from "@/hooks/useBreadcrumbScroll";
import { useLayoutMode, useSidebarAsSheet } from "@/hooks/useLayoutMode";
import { getPathCrumbs } from "@/lib/breadcrumbPath";
import { getVaultIcon, type VaultIconMap } from "@/lib/vaultIcons";
import { anchorForTrigger, type PopoverAnchor } from "@/lib/usePopoverOverflowAlign";
import type { FileVersion } from "@/lib/fileVersions";
import { cn } from "@/lib/utils";
import { getVaultCapabilities, vaultCapabilityHint } from "@/platform";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";
import { useVersioningSettingsStore } from "@/store/useVersioningSettingsStore";

type DocumentPanelProps = {
  selectedFilePath: string | null;
  selectedFileLabel: string | null;
  vaultIcons: VaultIconMap;
  /** Sets one entry's icon; the path is absolute. Only wired on the desktop. */
  onSetVaultIcon: (entryPath: string, icon: string | null) => void;
  selectedFileDirectoryLabel: string;
  /** The open note is a folder's note: titled after the folder, renaming renames the folder. */
  isSelectedFolderNote: boolean;
  folderPath: string | null;
  selectedFileContent: string | null;
  appVersion: string | null;

  /** Vault-relative label of the note a back/forward step opens, null when there is none. */
  backTargetLabel: string | null;
  forwardTargetLabel: string | null;
  onNavigateBack: () => void;
  onNavigateForward: () => void;

  isRenamingTitle: boolean;
  titleDraft: string;
  titleInputRef: RefObject<HTMLInputElement | null>;
  onTitleDraftChange: (value: string) => void;
  onCommitTitleRename: () => void;
  onCancelTitleRename: () => void;
  onStartTitleRename: () => void;
  /** Opens a folder's note from a breadcrumb crumb; the path is vault-relative. */
  onOpenFolderNote: (folderRelativePath: string) => void;

  isAiLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  isSelectedFileMissing: boolean;
  isFileLoading: boolean;
  fileError: string | null;
  saveError: string | null;

  editorHandleRef: RefObject<EditorHandle | null>;
  editorFocusRequestId: number;
  onMarkdownChange: (markdown: string) => void;
  onCanonicalMarkdown: (filePath: string, markdown: string) => void;
  onRequestSidebarFocus: () => void;
  onRequestFileOpen: (targetFilePath: string) => void;
  onAiLoadingChange: (isLoading: boolean) => void;
  onAiPendingChange: (isPending: boolean) => void;
  onAiSettingsRequest: () => void;
  onZenModeRequest: () => void;
  onVersionDiffRequest: (version: FileVersion) => void;
  onVersionRestoreRequest: (version: FileVersion) => void;

  /** Phone and upright tablet: the sidebar is a sheet and this opens it. */
  onOpenSidebar: () => void;
  /** Phone and tablet: the status pill doubles as the save button. */
  onSaveRequest: () => void;
};

/** Every note is a .md file, so the extension says nothing in a crumb. */
function crumbDisplayName(name: string): string {
  return name.replace(/\.md$/i, "");
}

/**
 * A crumb's icon. Only shown when one is set — the breadcrumb is the row
 * under the most pressure for space, and a default glyph in front of every
 * folder would cost exactly where the path is already too long. The tree is
 * where an icon is picked for an entry that has none.
 *
 * With a pointer, an icon that is there is also the shortcut to change it;
 * on touch (no `onPick`) it is a plain glyph, since a target this small
 * sitting inside a scrolling row is one a finger only hits by accident.
 */
function CrumbIcon({
  icon,
  onPick,
  label
}: {
  icon: string | null;
  onPick?: (anchor: PopoverAnchor) => void;
  label: string;
}) {
  if (!icon) {
    return null;
  }

  if (!onPick) {
    return (
      <span className="detail-panel__crumb-icon" aria-hidden="true">
        {icon}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="detail-panel__crumb-icon detail-panel__crumb-icon--button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onPick(anchorForTrigger(event.currentTarget.getBoundingClientRect()));
      }}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

export function DocumentPanel({
  selectedFilePath,
  selectedFileLabel,
  vaultIcons,
  onSetVaultIcon,
  selectedFileDirectoryLabel,
  isSelectedFolderNote,
  folderPath,
  selectedFileContent,
  appVersion,
  backTargetLabel,
  forwardTargetLabel,
  onNavigateBack,
  onNavigateForward,
  isRenamingTitle,
  titleDraft,
  titleInputRef,
  onTitleDraftChange,
  onCommitTitleRename,
  onCancelTitleRename,
  onStartTitleRename,
  onOpenFolderNote,
  isAiLoading,
  isSaving,
  isDirty,
  isSelectedFileMissing,
  isFileLoading,
  fileError,
  saveError,
  editorHandleRef,
  editorFocusRequestId,
  onMarkdownChange,
  onCanonicalMarkdown,
  onRequestSidebarFocus,
  onRequestFileOpen,
  onAiLoadingChange,
  onAiPendingChange,
  onAiSettingsRequest,
  onZenModeRequest,
  onVersionDiffRequest,
  onVersionRestoreRequest,
  onOpenSidebar,
  onSaveRequest
}: DocumentPanelProps) {
  const { t } = useTranslation();
  const layout = useLayoutMode();
  const sidebarAsSheet = useSidebarAsSheet();
  // Desktop: the editor's toolbar is portalled here, above the title row, so
  // the formatting controls sit at the top of the panel. Tablet and phone keep
  // it inside the editor, where responsive.css moves it below the text. A
  // state (not a ref) so the editor re-renders once the slot exists.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  // Bumped by the header menu's "Versions" entry on the phone, where the
  // popover's own trigger button has no room in the header.
  const [versionsRequestId, setVersionsRequestId] = useState(0);
  const capabilities = getVaultCapabilities();
  const capabilityHint = vaultCapabilityHint();
  const versioningEnabled = useVersioningSettingsStore((state) => state.versioningEnabled);
  const closeFindPanel = useSearchStore((state) => state.closePanel);
  const autoSaveEnabled = useEditorSettingsStore((state) => state.autoSaveEnabled);
  // Folder notes turn every folder into something that can be opened, so the
  // crumbs in front of the note become links; with the feature off the same
  // crumbs are plain text. The ".md" is dropped from the label first, so the
  // rendered text stays exactly the path the title showed before.
  const folderNotesEnabled = useEditorSettingsStore((state) => state.folderNotesEnabled);
  // Split on the full label: the crumbs carry the paths icons are keyed by,
  // and those keep the extension. Only the rendered name drops it, since
  // every note is a .md file and the suffix says nothing.
  const titleCrumbs = getPathCrumbs(selectedFileLabel ?? "");
  const breadcrumbScroll = useBreadcrumbScroll<HTMLHeadingElement>(selectedFileLabel ?? null);
  const [crumbIconPicker, setCrumbIconPicker] = useState<{
    relativePath: string;
    anchor: PopoverAnchor;
  } | null>(null);
  // Desktop only: see CrumbIcon. Tablet counts as touch here — the row is
  // already tight there, and the tree is one tap away.
  const canPickCrumbIcon = layout === "desktop" && folderPath !== null;

  // With auto-save on, unsaved edits are a write that is about to happen, not
  // a task for the user: the button drops the accent and goes quiet instead
  // of asking for a click. No spinner here, since the state is on for the
  // whole time someone is typing and a permanently spinning icon reads as
  // "stuck"; the spinner is kept for the write itself. It still saves on
  // click, for the impatient. A file removed underneath us stays a decision
  // either way (useAutoSave leaves it alone).
  const isAutoSavePending = autoSaveEnabled && isDirty && !isSelectedFileMissing;
  // The save button's label: visible text on the desktop, the accessible
  // name of the icon-only button on phone and tablet.
  const saveStateLabel = isSaving || isAutoSavePending
    ? t("app.statusSaving")
    : isSelectedFileMissing
      ? t("app.statusFileRemoved")
      : isDirty
        ? t("app.saveButtonTitle")
        : t("app.statusSaved");

  // Find & replace normally lives inside <Editor> (it needs the ProseMirror
  // document). Whenever no editor is mounted — no file open, or the selected
  // one still loading/failed — this standalone copy takes over so Ctrl+F is
  // never a dead shortcut; it searches the vault and jumps into the first hit.
  const isEditorMounted =
    Boolean(selectedFilePath) &&
    !fileError &&
    !saveError &&
    !isFileLoading &&
    selectedFileContent !== null;
  const standaloneFindPanel = isEditorMounted ? null : (
    <FindReplacePanel
      editor={null}
      folderPath={folderPath}
      // Kept even though there is no editor: it tells the panel a document
      // exists but is only mid-load, which must not silently switch the user
      // into all-files mode.
      filePath={selectedFilePath}
      onClose={closeFindPanel}
      onRequestFileOpen={onRequestFileOpen}
    />
  );

  return (
    <section className="detail-panel" aria-label={t("app.documentAreaLabel")}>
      {selectedFilePath ? (
        <div className="detail-panel__card detail-panel__card--document">
          {standaloneFindPanel}
          {layout === "desktop" ? <div className="detail-panel__toolbar" ref={setToolbarSlot} /> : null}
          <div className="detail-panel__header">
            <div className="detail-panel__title">
              {sidebarAsSheet ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="detail-panel__sidebar-button"
                  aria-label={t("app.openSidebar")}
                  title={t("app.openSidebar")}
                  data-testid="open-sidebar"
                  onClick={onOpenSidebar}
                >
                  <PanelLeft />
                </Button>
              ) : null}
              {/* Navigation across notes belongs to the document as a whole, so
                  it sits with the file name rather than in the format toolbar.
                  On the phone it moves into the header menu. */}
              <div className="detail-panel__history">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={backTargetLabel === null}
                  aria-label={t("app.navigateBack")}
                  title={
                    backTargetLabel
                      ? t("app.navigateBackTo", { fileLabel: backTargetLabel })
                      : t("app.navigateBack")
                  }
                  onClick={onNavigateBack}
                >
                  <ArrowLeft />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={forwardTargetLabel === null}
                  aria-label={t("app.navigateForward")}
                  title={
                    forwardTargetLabel
                      ? t("app.navigateForwardTo", { fileLabel: forwardTargetLabel })
                      : t("app.navigateForward")
                  }
                  onClick={onNavigateForward}
                >
                  <ArrowRight />
                </Button>
              </div>

              {isRenamingTitle ? (
                <h2 className="detail-panel__title-edit">
                  {selectedFileDirectoryLabel ? (
                    <span className="detail-panel__title-prefix">
                      {selectedFileDirectoryLabel}
                    </span>
                  ) : null}
                  <input
                    ref={titleInputRef}
                    className="detail-panel__title-input"
                    value={titleDraft}
                    onChange={(event) => onTitleDraftChange(event.target.value)}
                    onBlur={() => onCommitTitleRename()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onCommitTitleRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        onCancelTitleRename();
                      }
                    }}
                    aria-label={t(isSelectedFolderNote ? "app.folderNameLabel" : "app.fileNameLabel")}
                    spellCheck={false}
                  />
                </h2>
              ) : (
                <>
                  <h2
                    data-testid="note-title"
                    ref={breadcrumbScroll.elementRef}
                    onScroll={breadcrumbScroll.onScroll}
                    className={cn(
                      "detail-panel__breadcrumb",
                      breadcrumbScroll.isAtStart && "detail-panel__breadcrumb--at-start"
                    )}
                  >
                    {/* One bidi isolate around the crumbs, so a path mixing
                        scripts keeps its crumb boxes in reading order. */}
                    <span className="detail-panel__breadcrumb-text">
                      {titleCrumbs.map((crumb, index) => (
                        <Fragment key={crumb.folderRelativePath ?? `leaf-${index}`}>
                          {index > 0 ? (
                            <span className="detail-panel__crumb-separator" aria-hidden="true">
                              /
                            </span>
                          ) : null}
                          <CrumbIcon
                            icon={getVaultIcon(vaultIcons, crumb.relativePath)}
                            onPick={
                              canPickCrumbIcon
                                ? (anchor) =>
                                    setCrumbIconPicker({ relativePath: crumb.relativePath, anchor })
                                : undefined
                            }
                            label={t("fileTree.changeIcon")}
                          />
                          {crumb.folderRelativePath !== null && folderNotesEnabled ? (
                            <button
                              type="button"
                              className="detail-panel__crumb detail-panel__crumb--link"
                              onClick={() => onOpenFolderNote(crumb.folderRelativePath as string)}
                              title={t("fileTree.openFolderNote", { path: crumb.folderRelativePath })}
                            >
                              {crumbDisplayName(crumb.name)}
                            </button>
                          ) : (
                            <span
                              className={cn(
                                "detail-panel__crumb",
                                crumb.folderRelativePath === null && "detail-panel__crumb--leaf"
                              )}
                            >
                              {crumbDisplayName(crumb.name)}
                            </span>
                          )}
                        </Fragment>
                      ))}
                    </span>
                  </h2>
                  {crumbIconPicker && folderPath ? (
                    <EmojiPickerPopover
                      anchor={crumbIconPicker.anchor}
                      onSelect={(emoji) => {
                        void join(folderPath, crumbIconPicker.relativePath).then((path) =>
                          onSetVaultIcon(path, emoji)
                        );
                      }}
                      onClose={() => setCrumbIconPicker(null)}
                    />
                  ) : null}
                  {isSelectedFolderNote ? (
                    <span
                      className="detail-panel__title-badge"
                      title={t("app.folderNoteBadgeHint")}
                    >
                      <FolderOpen size={12} aria-hidden="true" />
                      <span className="detail-panel__title-badge-text">
                        {t("app.folderNoteBadge")}
                      </span>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="detail-panel__title-edit-button"
                    onClick={onStartTitleRename}
                    disabled={!capabilities.rename}
                    aria-label={t(isSelectedFolderNote ? "app.renameFolder" : "app.renameFile")}
                    title={
                      capabilities.rename
                        ? t(isSelectedFolderNote ? "app.renameFolder" : "app.renameFile")
                        : capabilityHint
                    }
                  >
                    <Pencil size={14} />
                  </button>
                </>
              )}
            </div>
            <div className="detail-panel__status-group">
              {isAiLoading ? (
                <div className="detail-panel__ai-chip" aria-live="polite">
                  <span className="detail-panel__ai-chip-message">{t("app.aiRequestRunning")}</span>
                  <button
                    type="button"
                    className="detail-panel__ai-chip-cancel"
                    onClick={() => editorHandleRef.current?.cancelAiRequest()}
                    aria-label={t("app.aiRequestCancel")}
                    title={t("app.aiRequestCancel")}
                  >
                    <Square size={10} fill="currentColor" strokeWidth={0} />
                  </button>
                </div>
              ) : null}
              {versioningEnabled ? (
                <VersionsPopover
                  folderPath={folderPath}
                  selectedFilePath={selectedFilePath}
                  onDiffRequest={onVersionDiffRequest}
                  onRestoreRequest={onVersionRestoreRequest}
                  triggerHidden={layout === "phone"}
                  openRequestId={versionsRequestId}
                />
              ) : null}
              {/* The thing showing the save state is also what saves, on
                  every layout: without a keyboard there is no Ctrl+S, and
                  with one a click still beats reading a pill. The desktop
                  has room for the words; phone and tablet keep the icon
                  alone, since the word costs the width the file name needs,
                  and carry the state through the colour plus the announced
                  label. */}
              <Button
                type="button"
                size={layout === "desktop" ? "sm" : "icon-sm"}
                variant={isDirty && !isSaving && !isAutoSavePending ? "default" : "outline"}
                className={cn(
                  "detail-panel__save-button",
                  isAutoSavePending && "detail-panel__save-button--auto",
                  isSelectedFileMissing && "detail-panel__save-button--warning"
                )}
                aria-label={layout === "desktop" ? undefined : saveStateLabel}
                data-testid="status"
                data-dirty={isDirty ? "true" : "false"}
                disabled={!isDirty || isSaving}
                title={isDirty && !isSaving ? t("app.saveButtonTitle") : saveStateLabel}
                onClick={onSaveRequest}
              >
                {isSaving ? (
                  <Loader2 className="animate-spin" />
                ) : isSelectedFileMissing ? (
                  <AlertTriangle />
                ) : isDirty ? (
                  <Save />
                ) : (
                  <Check />
                )}
                {layout === "desktop" ? saveStateLabel : null}
              </Button>
              {/* A changing aria-label is not announced; where the label is
                  not visible text, the state change needs its own live
                  region. */}
              {layout === "desktop" ? null : (
                <span className="sr-only" role="status" aria-live="polite">
                  {saveStateLabel}
                </span>
              )}
              {/* The chat toggle is the format toolbar's, at the bottom of
                  the screen next to the other AI buttons: the header has no
                  width to spare and the thumb is down there anyway. */}
              {layout !== "desktop" ? (
                <DocumentMenu
                  editorHandleRef={editorHandleRef}
                  backTargetLabel={backTargetLabel}
                  forwardTargetLabel={forwardTargetLabel}
                  onNavigateBack={onNavigateBack}
                  onNavigateForward={onNavigateForward}
                  onVersionsRequest={() => setVersionsRequestId((id) => id + 1)}
                  versioningEnabled={versioningEnabled}
                  onZenModeRequest={onZenModeRequest}
                />
              ) : null}
            </div>
          </div>

          <div className="detail-panel__body">
            {fileError || saveError ? (
              <div className="detail-panel__message detail-panel__message--error">
                {fileError ?? saveError}
              </div>
            ) : isFileLoading || selectedFileContent === null ? (
              <div className="detail-panel__message">
                {t("app.fileLoading")}
              </div>
            ) : (
              <Editor
                key={selectedFilePath}
                ref={editorHandleRef}
                markdown={selectedFileContent}
                onMarkdownChange={onMarkdownChange}
                onCanonicalMarkdown={onCanonicalMarkdown}
                folderPath={folderPath}
                filePath={selectedFilePath}
                editorFocusRequestId={editorFocusRequestId}
                onRequestSidebarFocus={onRequestSidebarFocus}
                onRequestFileOpen={onRequestFileOpen}
                onAiLoadingChange={onAiLoadingChange}
                onAiPendingChange={onAiPendingChange}
                onAiSettingsRequest={onAiSettingsRequest}
                onZenModeRequest={onZenModeRequest}
                toolbarContainer={layout === "desktop" ? toolbarSlot : null}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="detail-panel__card detail-panel__card--empty">
          {standaloneFindPanel}
          {sidebarAsSheet ? (
            // No note, no header: the sheet button still has to be somewhere.
            <div className="detail-panel__header detail-panel__header--empty">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="detail-panel__sidebar-button"
                aria-label={t("app.openSidebar")}
                title={t("app.openSidebar")}
                data-testid="open-sidebar"
                onClick={onOpenSidebar}
              >
                <PanelLeft />
              </Button>
              <span className="detail-panel__app-name">ScribeDog</span>
            </div>
          ) : null}
          <p className="detail-panel__eyebrow">{t("app.emptyEyebrow")}</p>
          <h2>{t("app.emptyTitle")}</h2>
          {appVersion ? <p className="detail-panel__version">{t("app.version", { version: appVersion })}</p> : null}
        </div>
      )}
    </section>
  );
}
