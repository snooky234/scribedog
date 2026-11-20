import { useEffect } from "react";
import { platform } from "@/platform";
import { buildDocumentTitle, parseTitleFormat, TITLE_FORMAT_META_NAME } from "@/lib/documentTitle";
import { getFolderBasename } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { sharedVaultNameFor, useSharedVaultsStore } from "@/store/useSharedVaultsStore";

/**
 * The format comes from a meta tag the server edition fills in
 * (SCRIBEDOG_TITLE_FORMAT); the desktop build has no such tag and keeps the
 * built-in one.
 */
function readTitleFormat(): string | null {
  return parseTitleFormat(document.querySelector(`meta[name="${TITLE_FORMAT_META_NAME}"]`)?.getAttribute("content"));
}

/**
 * Keeps `document.title` on the open note or vault, for the browser tab,
 * its history and bookmarks. The desktop window keeps its native title; this
 * only sets the webview's document title there.
 *
 * In the browser the personal vault stays unnamed (its name is the host the
 * address bar already shows); a shared vault has a real name, which only
 * arrives once the server list has loaded, hence the subscription.
 */
export function useDocumentTitle(): void {
  const folderPath = useAppStore((state) => state.folderPath);
  const notePath = useAppStore((state) => state.selectedFilePath);
  const isDirty = useAppStore((state) => state.isDirty);
  const autoSaveEnabled = useEditorSettingsStore((state) => state.autoSaveEnabled);
  const sharedServers = useSharedVaultsStore((state) => state.servers);

  useEffect(() => {
    const vaultName = folderPath
      ? (sharedVaultNameFor(folderPath) ?? (platform.kind === "desktop" ? getFolderBasename(folderPath) : null))
      : null;

    document.title = buildDocumentTitle({
      folderPath,
      notePath,
      vaultName,
      // With auto-save on, the marker would blink on every pause in typing.
      showUnsaved: isDirty && !autoSaveEnabled,
      titleFormat: readTitleFormat()
    });
  }, [folderPath, notePath, isDirty, autoSaveEnabled, sharedServers]);
}
