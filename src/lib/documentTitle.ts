import { getFolderNoteFolderPath, getNoteDisplayName, isFolderNotePath } from "@/lib/folderNotes";

/**
 * The window title: what is open, then the app. The specific part comes
 * first because a browser tab cuts a long title from the right, and ten tabs
 * all reading "ScribeDog" tell the user nothing. Pure, so the hook in App.tsx
 * only collects the inputs.
 */

export const APP_TITLE = "ScribeDog";

/** Marks a note with unsaved changes, the way editors mark a dirty tab. */
export const UNSAVED_MARKER = "● ";

export type DocumentTitleInput = {
  /** The open vault's root, or null when none is open. */
  folderPath: string | null;
  /** The open note, or null when none is open. */
  notePath: string | null;
  /**
   * The vault's name, or null where it would add nothing: the browser's own
   * vault is named by the URL in the address bar already.
   */
  vaultName: string | null;
  /** Show the unsaved marker; the caller leaves it off while auto-save runs. */
  showUnsaved: boolean;
};

function samePath(left: string, right: string): boolean {
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

  return normalize(left) === normalize(right);
}

/**
 * The note's name as the tree shows it. A folder note directly in the vault
 * root has no folder of its own to be named after (the tree lists it as an
 * ordinary note), so its folder's name would be the vault's technical root.
 */
function noteTitle(notePath: string, folderPath: string | null): string | null {
  if (isFolderNotePath(notePath) && folderPath && samePath(getFolderNoteFolderPath(notePath), folderPath)) {
    return null;
  }

  return getNoteDisplayName(notePath).trim() || null;
}

export function buildDocumentTitle({ folderPath, notePath, vaultName, showUnsaved }: DocumentTitleInput): string {
  const note = notePath ? noteTitle(notePath, folderPath) : null;

  if (note) {
    return `${showUnsaved ? UNSAVED_MARKER : ""}${note} - ${APP_TITLE}`;
  }

  const vault = folderPath ? vaultName?.trim() : null;

  return vault ? `${vault} - ${APP_TITLE}` : APP_TITLE;
}
