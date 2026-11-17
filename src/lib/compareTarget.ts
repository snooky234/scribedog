import { normalizePathKey } from "@/store/appStore/pathUtils";

/**
 * Which note "Open as reference" keeps beside the editor after the vault changed
 * under it. Pure, so the rules can be read in one place:
 *
 * - The compared note opened in the editor: the two swap sides. The note
 *   that was open moves into the pane, so clicking the compared note in the
 *   sidebar reads as "let me work on that one now", not as closing the
 *   comparison. With nothing open before, there is nothing to compare with.
 * - The compared note is gone from the vault (deleted, renamed, moved): the
 *   pane closes rather than showing a file that is no longer there.
 */
export function samePath(left: string | null, right: string | null): boolean {
  return left !== null && right !== null && normalizePathKey(left) === normalizePathKey(right);
}

export function compareTargetAfterSelection(
  compareFilePath: string | null,
  previousSelectedPath: string | null,
  nextSelectedPath: string | null
): string | null {
  if (compareFilePath === null || !samePath(compareFilePath, nextSelectedPath)) {
    return compareFilePath;
  }

  if (previousSelectedPath === null || samePath(previousSelectedPath, compareFilePath)) {
    return null;
  }

  return previousSelectedPath;
}

export function compareTargetAfterTreeChange(
  compareFilePath: string | null,
  filePaths: readonly string[]
): string | null {
  if (compareFilePath === null) {
    return null;
  }

  return filePaths.some((filePath) => samePath(filePath, compareFilePath)) ? compareFilePath : null;
}
