import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ExportDialogTarget, ExportMode } from "@/components/ExportDialog";
import { collectOrderedRecords, getDefaultExportBaseName } from "@/lib/export/exporter";
import { getRelativeDisplayPath, readMarkdownFile, type MarkdownFileRecord } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";
import { isPathInsideFolder } from "@/store/appStore/pathUtils";

export function useExportTarget() {
  const { t } = useTranslation();
  const [exportTarget, setExportTarget] = useState<ExportDialogTarget | null>(null);

  const requestExportFile = (filePath: string, mode: ExportMode = "standard") => {
    setExportTarget({
      kind: "file",
      mode,
      sourcePath: filePath,
      defaultName: getDefaultExportBaseName(filePath)
    });
  };

  const requestExportFolder = (exportFolderPath: string, mode: ExportMode = "standard") => {
    setExportTarget({
      kind: "folder",
      mode,
      sourcePath: exportFolderPath,
      defaultName: getDefaultExportBaseName(exportFolderPath)
    });
  };

  const requestExportMultiple = (
    entries: Array<{ kind: "file" | "folder"; path: string }>,
    mode: ExportMode = "standard"
  ) => {
    if (entries.length === 0) {
      return;
    }

    if (entries.length === 1) {
      const [entry] = entries;

      if (entry.kind === "file") {
        requestExportFile(entry.path, mode);
      } else {
        requestExportFolder(entry.path, mode);
      }

      return;
    }

    setExportTarget({
      kind: "multiple",
      mode,
      entries,
      defaultName: t("exportDialog.defaultMultipleName")
    });
  };

  // Prefers unsaved in-memory content over the on-disk state, so an export
  // always matches what the user currently sees in the editor.
  const readMarkdownForExport = async (filePath: string): Promise<string> => {
    const document = useAppStore.getState().fileDocuments[filePath];
    return document ? document.content : readMarkdownFile(filePath);
  };

  /**
   * The notes behind a target, in the order the sidebar shows them — that
   * order is the chapter order of the compiled manuscript, so it has to come
   * from the same tree the user arranged, not from a fresh directory listing.
   */
  const resolveOrderedRecords = useCallback(
    (target: ExportDialogTarget): MarkdownFileRecord[] => {
      const { folderPath, filePaths, fileMtimeMs, sortMode, manualOrder } = useAppStore.getState();

      if (!folderPath) {
        return [];
      }

      const vaultRecords: MarkdownFileRecord[] = filePaths.map((filePath) => ({
        filePath,
        relativePath: getRelativeDisplayPath(folderPath, filePath),
        mtimeMs: fileMtimeMs[filePath] ?? 0
      }));

      const ordered = collectOrderedRecords(vaultRecords, sortMode, manualOrder);

      if (target.kind === "file") {
        return ordered.filter((record) => record.filePath === target.sourcePath);
      }

      if (target.kind === "folder") {
        return ordered.filter((record) => isPathInsideFolder(record.filePath, target.sourcePath));
      }

      return ordered.filter((record) =>
        target.entries.some((entry) =>
          entry.kind === "file"
            ? entry.path === record.filePath
            : isPathInsideFolder(record.filePath, entry.path)
        )
      );
    },
    []
  );

  const closeExport = () => setExportTarget(null);

  return {
    exportTarget,
    requestExportFile,
    requestExportFolder,
    requestExportMultiple,
    readMarkdownForExport,
    resolveOrderedRecords,
    closeExport
  };
}
