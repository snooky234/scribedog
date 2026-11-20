import { getFolderNoteFolderPath, getNoteDisplayName, isFolderNotePath } from "@/lib/folderNotes";

/**
 * The window title: what is open, then the app. The specific part comes
 * first because a browser tab cuts a long title from the right, and ten tabs
 * all reading "ScribeDog" tell the user nothing. Pure, so the hook in App.tsx
 * only collects the inputs.
 *
 * The server edition can replace the format (SCRIBEDOG_TITLE_FORMAT, handed
 * over in a meta tag); `{doc}` stands for the open note or vault.
 */

export const APP_TITLE = "ScribeDog";

/** The placeholder a title format names the open note or vault with. */
export const DOC_PLACEHOLDER = "{doc}";

export const DEFAULT_TITLE_FORMAT = `${DOC_PLACEHOLDER} - ${APP_TITLE}`;

/** Marks a note with unsaved changes, the way editors mark a dirty tab. */
export const UNSAVED_MARKER = "● ";

/** The meta tag the server edition puts SCRIBEDOG_TITLE_FORMAT into (vite.config.ts adds it to the web build). */
export const TITLE_FORMAT_META_NAME = "scribedog-title-format";

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
  /** A format with `{doc}`, or null/empty for the built-in one. */
  titleFormat?: string | null;
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

/**
 * The meta tag's content as a format: empty, or the placeholder a build
 * served without the server (`vite dev`), means the built-in one.
 */
export function parseTitleFormat(content: string | null | undefined): string | null {
  const value = content?.trim() ?? "";

  return value && !value.startsWith("__SCRIBEDOG_") ? value : null;
}

/** Separators left dangling at either end once `{doc}` is gone, e.g. "{doc} - ScribeDog". */
const DANGLING_SEPARATORS = /^[\s\-\u2013\u2014|:\u00b7\u2022,/]+|[\s\-\u2013\u2014|:\u00b7\u2022,/]+$/g;

function fillFormat(format: string, doc: string): string {
  // split/join rather than replace: a note called "$&" must stay literal.
  return format.split(DOC_PLACEHOLDER).join(doc);
}

export function buildDocumentTitle({
  folderPath,
  notePath,
  vaultName,
  showUnsaved,
  titleFormat
}: DocumentTitleInput): string {
  const format = titleFormat?.trim() || DEFAULT_TITLE_FORMAT;
  const note = notePath ? noteTitle(notePath, folderPath) : null;
  const vault = folderPath ? vaultName?.trim() || null : null;
  const doc = note ?? vault;

  if (doc) {
    return `${note && showUnsaved ? UNSAVED_MARKER : ""}${fillFormat(format, doc)}`;
  }

  // Nothing to name: the format without its placeholder, so "{doc} - Team"
  // reads "Team" and a bare "{doc}" falls back to the app's name.
  return fillFormat(format, "").replace(DANGLING_SEPARATORS, "") || APP_TITLE;
}
