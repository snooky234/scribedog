import { ABSOLUTE_URL_PATTERN, getRelativeDisplayPath } from "@/lib/fileSystem";

/**
 * Links between two notes of the same vault are plain relative Markdown links
 * (`[Note](../sub/note.md)`) — no custom syntax, so a linked vault stays
 * readable in any other Markdown tool. This module is the single place that
 * knows how such an href is built from two absolute paths and how it is
 * resolved back into the vault file it points at.
 */

/**
 * Drag payload the file tree writes and the editor reads on drop: a JSON
 * array of absolute file paths. A custom MIME type keeps a note dragged out
 * of the sidebar apart from a file dragged in from the OS (which arrives as
 * `dataTransfer.files`).
 */
export const FILE_LINK_DRAG_MIME = "application/x-scribedog-file-paths";

export type VaultFileOption = {
  filePath: string;
  /** Vault-relative, "/"-separated — what the picker shows and filters on. */
  relativePath: string;
  /** File name without the ".md" extension — the default link text. */
  label: string;
};

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

// Two spellings of the same Windows path differ in separators and case, so
// comparisons run on this key while the vault's own list stays the authority
// for the real spelling of a path.
function toPathKey(path: string): string {
  return toPosixPath(path).toLowerCase();
}

/** File name without the ".md" extension — the default text of a file link. */
export function getFileLinkLabel(filePath: string): string {
  const fileName = toPosixPath(filePath).split("/").pop() ?? filePath;
  return fileName.replace(/\.md$/i, "");
}

/**
 * Percent-encodes the segments of a relative path. Without this a file name
 * containing a space would serialize into `[Note](my note.md)`, which is not
 * a link at all once the Markdown is read back. Markdown-it percent-encodes
 * non-ASCII characters on its own when parsing, so encoding here also keeps a
 * freshly inserted link byte-identical to the same link after a reload.
 */
export function encodeFileLinkHref(relativePath: string): string {
  return relativePath
    .split("/")
    .map((segment) => (segment === "." || segment === ".." ? segment : encodeURIComponent(segment)))
    .join("/");
}

export function decodeFileLinkHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    // Malformed percent sequences stay as they are rather than breaking the
    // whole lookup.
    return href;
  }
}

/**
 * The href for a link from `fromFilePath` to `targetFilePath`, relative to the
 * linking file's own folder so the link keeps working when the whole vault is
 * moved or opened on another machine.
 */
export function buildFileLinkHref(fromFilePath: string, targetFilePath: string): string {
  const fromDirSegments = toPosixPath(fromFilePath).split("/").slice(0, -1);
  const targetSegments = toPosixPath(targetFilePath).split("/");

  let commonLength = 0;

  while (
    commonLength < fromDirSegments.length &&
    commonLength < targetSegments.length - 1 &&
    fromDirSegments[commonLength].toLowerCase() === targetSegments[commonLength].toLowerCase()
  ) {
    commonLength += 1;
  }

  const upwardSegments = Array.from(
    { length: fromDirSegments.length - commonLength },
    () => ".."
  );

  return encodeFileLinkHref([...upwardSegments, ...targetSegments.slice(commonLength)].join("/"));
}

/**
 * Whether an href addresses another note of the vault rather than the web.
 * Anything with a scheme (`https:`, `mailto:`, also `C:`), a protocol-relative
 * prefix or a bare fragment belongs to the opener, not to the file tree.
 */
export function isFileLinkHref(href: string): boolean {
  if (!href || ABSOLUTE_URL_PATTERN.test(href) || href.startsWith("#") || href.startsWith("//")) {
    return false;
  }

  const [path] = href.split(/[?#]/);

  return /\.md$/i.test(path);
}

/**
 * Resolves a relative href against the file it appears in and returns the
 * matching vault path — in the vault's own spelling, which is what the store
 * keys its open documents by. `null` means the target is not a known file of
 * the vault (renamed, deleted, or outside the opened folder).
 */
export function resolveFileLinkTarget(
  href: string,
  fromFilePath: string,
  vaultFilePaths: string[]
): string | null {
  const [rawPath] = href.split(/[?#]/);
  const segments = toPosixPath(fromFilePath).split("/").slice(0, -1);

  for (const segment of decodeFileLinkHref(rawPath).split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  const targetKey = toPathKey(segments.join("/"));

  return vaultFilePaths.find((filePath) => toPathKey(filePath) === targetKey) ?? null;
}

/**
 * `resolveFileLinkTarget` for an href that does not sit inside a note: a chat
 * answer names notes relative to the vault root, so there is no linking file
 * to resolve against.
 */
export function resolveVaultRelativeFileLink(
  href: string,
  folderPath: string,
  vaultFilePaths: string[]
): string | null {
  // The trailing separator stands in for the linking file whose folder
  // resolveFileLinkTarget strips off — here that folder is the vault root.
  return resolveFileLinkTarget(href, `${toPosixPath(folderPath)}/`, vaultFilePaths);
}

/** Reads the dragged vault notes back out of a drop event's data transfer. */
export function getDraggedVaultFilePaths(dataTransfer: DataTransfer | null): string[] {
  const payload = dataTransfer?.getData(FILE_LINK_DRAG_MIME);

  if (!payload) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(payload);

    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && /\.md$/i.test(entry))
      : [];
  } catch {
    return [];
  }
}

export function buildVaultFileOptions(
  folderPath: string | null,
  filePaths: string[],
  excludeFilePath?: string | null
): VaultFileOption[] {
  const excludedKey = excludeFilePath ? toPathKey(excludeFilePath) : null;

  return filePaths
    .filter((filePath) => toPathKey(filePath) !== excludedKey)
    .map((filePath) => ({
      filePath,
      relativePath: folderPath ? getRelativeDisplayPath(folderPath, filePath) : toPosixPath(filePath),
      label: getFileLinkLabel(filePath)
    }));
}

/**
 * Ranks the vault's notes against what the user has typed so far: name
 * prefixes first, then names containing the query, then any path match. An
 * empty query lists the first `limit` notes so the picker is never empty.
 */
export function filterVaultFileOptions(
  options: VaultFileOption[],
  query: string,
  limit = 20
): VaultFileOption[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return options.slice(0, limit);
  }

  const scored: Array<{ option: VaultFileOption; score: number }> = [];

  for (const option of options) {
    const label = option.label.toLowerCase();
    const relativePath = option.relativePath.toLowerCase();
    const score = label.startsWith(normalizedQuery)
      ? 0
      : label.includes(normalizedQuery)
        ? 1
        : relativePath.includes(normalizedQuery)
          ? 2
          : -1;

    if (score >= 0) {
      scored.push({ option, score });
    }
  }

  return scored
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.option.relativePath.localeCompare(right.option.relativePath, undefined, {
          numeric: true,
          sensitivity: "base"
        })
    )
    .slice(0, limit)
    .map((entry) => entry.option);
}
