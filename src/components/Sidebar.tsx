import { FileText, FolderOpen, FolderPlus, Keyboard, Plus, Settings2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { FileTree, type PendingFolderRename } from "@/components/FileTree";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatFolderLabel } from "@/lib/fileSystem";

type SidebarProps = {
  folderPath: string | null;
  filePaths: string[];
  emptyFolderPaths: string[];
  selectedFilePath: string | null;
  dirtyFilePaths: string[];
  folderError: string | null;
  isLoading: boolean;
  pendingFolderRename: PendingFolderRename | null;
  onOpenFolder: () => void;
  onCreateFile: () => void;
  onCreateFileRequest: (targetDirectory: string) => void;
  onCreateFolder: () => void;
  onSelectFilePath: (filePath: string) => Promise<void>;
  onDeleteFileRequest: (filePath: string) => void;
  onDeleteFolderRequest: (folderPath: string) => void;
  onRenameFolder: (folderPath: string, newBaseName: string) => Promise<boolean>;
  onRenameFile: (filePath: string, newBaseName: string) => Promise<boolean>;
  onAiSettingsRequest: () => void;
  onShortcutsRequest: () => void;
  onRequestEditorFocus: () => void;
  sidebarFocusRequestId: number;
};

export function Sidebar({
  folderPath,
  filePaths,
  emptyFolderPaths,
  selectedFilePath,
  dirtyFilePaths,
  folderError,
  isLoading,
  pendingFolderRename,
  onOpenFolder,
  onCreateFile,
  onCreateFileRequest,
  onCreateFolder,
  onSelectFilePath,
  onDeleteFileRequest,
  onDeleteFolderRequest,
  onRenameFolder,
  onRenameFile,
  onAiSettingsRequest,
  onShortcutsRequest,
  onRequestEditorFocus,
  sidebarFocusRequestId
}: SidebarProps) {
  const { t } = useTranslation();
  const folderLabel = formatFolderLabel(folderPath);

  return (
    <aside className="sidebar-panel" aria-label={t("sidebar.filesLabel")}>
      <div className="sidebar-panel__header">
        <div className="sidebar-panel__actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenFolder}
            disabled={isLoading}
            className="sidebar-panel__open"
            aria-label={t("sidebar.openFolder")}
            title={t("sidebar.openFolder")}
          >
            <FolderOpen />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateFolder}
            disabled={isLoading || folderPath === null}
            aria-label={t("sidebar.newFolder")}
            title={t("sidebar.newFolder")}
          >
            <FolderPlus />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateFile}
            disabled={isLoading || folderPath === null}
            aria-label={t("sidebar.newFile")}
            title={t("sidebar.newFile")}
          >
            <Plus />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => selectedFilePath && onDeleteFileRequest(selectedFilePath)}
            disabled={isLoading || selectedFilePath === null}
            aria-label={t("sidebar.deleteFile")}
            title={t("sidebar.deleteSelectedFile")}
          >
            <Trash2 />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAiSettingsRequest}
            aria-label={t("sidebar.settings")}
            title={t("sidebar.settings")}
          >
            <Settings2 />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onShortcutsRequest}
            aria-label={t("sidebar.shortcuts")}
            title={t("sidebar.shortcutsTitle")}
          >
            <Keyboard />
          </Button>
        </div>
        <div>
          <p className="sidebar-panel__folder">{folderLabel}</p>
        </div>        
      </div>

      {folderError ? (
        <div className="sidebar-panel__message sidebar-panel__message--error">
          {folderError}
        </div>
      ) : null}

      {isLoading ? (
        <div className="sidebar-panel__message">{t("sidebar.searchingFolder")}</div>
      ) : folderPath === null ? (
        <button
          type="button"
          className="sidebar-panel__empty sidebar-panel__empty--interactive"
          onClick={onOpenFolder}
          disabled={isLoading}
        >
          <FolderOpen />
          <p>{t("sidebar.openFolderPrompt")}</p>
        </button>
      ) : filePaths.length === 0 && emptyFolderPaths.length === 0 ? (
        <button
          type="button"
          className="sidebar-panel__empty sidebar-panel__empty--interactive"
          onClick={onOpenFolder}
          disabled={isLoading}
        >
          <FileText />
          <p>{t("sidebar.noMarkdownFiles")}</p>
        </button>
      ) : null}

      <ScrollArea className="sidebar-panel__scroll">
        {folderPath !== null && (filePaths.length > 0 || emptyFolderPaths.length > 0) ? (
          <FileTree
            key={folderPath}
            folderPath={folderPath}
            filePaths={filePaths}
            emptyFolderPaths={emptyFolderPaths}
            selectedFilePath={selectedFilePath}
            dirtyFilePaths={dirtyFilePaths}
            pendingFolderRename={pendingFolderRename}
            onSelectFilePath={onSelectFilePath}
            onCreateFileRequest={onCreateFileRequest}
            onDeleteFileRequest={onDeleteFileRequest}
            onDeleteFolderRequest={onDeleteFolderRequest}
            onRenameFolder={onRenameFolder}
            onRenameFile={onRenameFile}
            onRequestEditorFocus={onRequestEditorFocus}
            focusRequestId={sidebarFocusRequestId}
          />
        ) : null}
      </ScrollArea>
    </aside>
  );
}