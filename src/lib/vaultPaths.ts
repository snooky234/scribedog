/**
 * Pure path helpers for vault paths, with no dependency on the platform layer,
 * so both platform implementations and the shared vault logic can use them.
 * Re-exported from lib/fileSystem.ts, where callers have always found them.
 */

export const VAULT_META_DIR_NAME = ".scribedog";

export const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

export function isMarkdownFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

export function normalizeDisplayPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Whether an already-resolved absolute path still lies inside the vault.
 * Case-insensitive, because Windows paths are.
 */
export function isPathInsideVault(rootPath: string, filePath: string): boolean {
  const normalizedRootPath = normalizeDisplayPath(rootPath).toLowerCase();
  const normalizedFilePath = normalizeDisplayPath(filePath).toLowerCase();

  return normalizedFilePath.startsWith(`${normalizedRootPath}/`);
}

export function getRelativeDisplayPath(rootPath: string, filePath: string): string {
  const normalizedRootPath = normalizeDisplayPath(rootPath);
  const normalizedFilePath = normalizeDisplayPath(filePath);

  if (normalizedFilePath === normalizedRootPath) {
    return "";
  }

  if (normalizedFilePath.startsWith(`${normalizedRootPath}/`)) {
    return normalizedFilePath.slice(normalizedRootPath.length + 1);
  }

  return normalizedFilePath;
}

export function sortMarkdownRecords<T extends { relativePath: string }>(records: T[]): T[] {
  return records.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
}
