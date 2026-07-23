import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ExportDialogTarget } from "@/components/ExportDialog";
import { getDefaultExportBaseName } from "@/lib/export/exporter";
import { readMarkdownFile } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";

export function useExportTarget() {
  const { t } = useTranslation();
  const [exportTarget, setExportTarget] = useState<ExportDialogTarget | null>(null);

  const requestExportFile = (filePath: string) => {
    setExportTarget({
      kind: "file",
      sourcePath: filePath,
      defaultName: getDefaultExportBaseName(filePath)
    });
  };

  const requestExportFolder = (exportFolderPath: string) => {
    setExportTarget({
      kind: "folder",
      sourcePath: exportFolderPath,
      defaultName: getDefaultExportBaseName(exportFolderPath)
    });
  };

  const requestExportMultiple = (entries: Array<{ kind: "file" | "folder"; path: string }>) => {
    if (entries.length === 0) {
      return;
    }

    if (entries.length === 1) {
      const [entry] = entries;

      if (entry.kind === "file") {
        requestExportFile(entry.path);
      } else {
        requestExportFolder(entry.path);
      }

      return;
    }

    setExportTarget({
      kind: "multiple",
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

  const closeExport = () => setExportTarget(null);

  return {
    exportTarget,
    requestExportFile,
    requestExportFolder,
    requestExportMultiple,
    readMarkdownForExport,
    closeExport
  };
}
