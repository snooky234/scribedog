import { ABSOLUTE_URL_PATTERN, getRelativeDisplayPath, isPathInsideVault } from "@/lib/vaultPaths";

/**
 * The images of the last selection cut or copied out of a note: their `src`
 * as that note references them, the note itself, and whether the image
 * cleanup still has to spare them.
 *
 * Two jobs hang off this record. Cutting an image to paste it elsewhere
 * removes it from its note first, and the save that follows (auto-save: a
 * second later) would take it for deleted and remove the file before the
 * paste can refer to it, so the images are protected until they are pasted.
 * After that a note references them again and the cleanup treats them like
 * any other image: deleting the note they were pasted into deletes them too.
 * One that is never pasted stays behind unused, the harmless failure of the
 * two. And the references are relative to the note they came from, so a
 * paste into a note in another folder has to rewrite them, which needs to
 * know that note for as long as the clipboard can be pasted again.
 */
type ClipboardImages = { filePath: string; sources: string[]; isProtected: boolean };

let clipboardImages: ClipboardImages | null = null;

/** Records the images a cut or copy just put on the clipboard (none: forgets the last ones). */
export function holdClipboardImages(filePath: string | null, sources: string[]): void {
  clipboardImages =
    filePath && sources.length > 0 ? { filePath, sources: [...sources], isProtected: true } : null;
}

/** The clipboard's images while the cleanup still has to spare them. */
export function getProtectedClipboardImages(): { filePath: string; sources: string[] } | null {
  return clipboardImages?.isProtected ? clipboardImages : null;
}

/**
 * Called for a paste: rewrites a reference that came from the clipboard's
 * note so it resolves from `toFilePath`, and ends the protection, since a
 * note now references the image again. Anything else is left alone.
 */
export function adoptPastedImageSource(src: string, toFilePath: string | null, folderPath: string | null): string {
  const held = clipboardImages;

  if (!held || !held.sources.includes(src)) {
    return src;
  }

  held.isProtected = false;

  return toFilePath && folderPath ? rebaseImageSource(src, held.filePath, toFilePath, folderPath) : src;
}

function directorySegments(folderPath: string, filePath: string): string[] {
  return getRelativeDisplayPath(folderPath, filePath).split("/").slice(0, -1);
}

/**
 * The relative image reference `src` of the note `fromFilePath`, rewritten to
 * resolve from `toFilePath` in the form the editor writes itself (up to the
 * vault root, then down: "../images/a.png"). Left as it is when both notes
 * share a folder, and when it is absolute or does not resolve inside the vault.
 */
export function rebaseImageSource(
  src: string,
  fromFilePath: string,
  toFilePath: string,
  folderPath: string
): string {
  if (
    !src ||
    ABSOLUTE_URL_PATTERN.test(src) ||
    src.startsWith("/") ||
    !isPathInsideVault(folderPath, fromFilePath) ||
    !isPathInsideVault(folderPath, toFilePath)
  ) {
    return src;
  }

  const fromDirectory = directorySegments(folderPath, fromFilePath);
  const toDirectory = directorySegments(folderPath, toFilePath);

  if (fromDirectory.join("/").toLowerCase() === toDirectory.join("/").toLowerCase()) {
    return src;
  }

  const resolved = [...fromDirectory];

  for (const segment of src.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (resolved.length === 0) {
        return src;
      }

      resolved.pop();
      continue;
    }

    resolved.push(segment);
  }

  return `${"../".repeat(toDirectory.length)}${resolved.join("/")}`;
}
