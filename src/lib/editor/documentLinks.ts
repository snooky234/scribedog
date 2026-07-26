import { isFileLinkHref, resolveFileLinkTarget } from "./fileLinks";

/**
 * Reading links back out of Markdown — what the links/backlinks panel is built
 * on. Inline links only: images (`![alt](src)`) are skipped, and reference
 * definitions are not part of what the editor ever writes.
 */

// Matches the destination of an inline link: "](" followed by either an
// angle-bracketed destination or a run of characters up to the first
// unescaped ")" or whitespace (a title).
const MARKDOWN_LINK_PATTERN =
  /(!?)\[(?:\\.|[^[\]\\])*\]\(\s*(<[^>\n]*>|(?:\\.|[^()\s])*)/g;

function unescapeDestination(destination: string): string {
  const withoutBrackets =
    destination.startsWith("<") && destination.endsWith(">")
      ? destination.slice(1, -1)
      : destination;

  return withoutBrackets.replace(/\\(.)/g, "$1");
}

/** Every inline link destination of the document, in document order. */
export function extractMarkdownLinkHrefs(markdown: string): string[] {
  const hrefs: string[] = [];

  for (const match of markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const [, imageMarker, destination] = match;

    if (imageMarker === "!" || !destination) {
      continue;
    }

    hrefs.push(unescapeDestination(destination));
  }

  return hrefs;
}

export type OutgoingFileLink = {
  href: string;
  /** `null` when the href points at no note of the opened vault (any more). */
  targetFilePath: string | null;
};

/**
 * The document's links to other notes of the vault, deduplicated by href and
 * without the document's own self-links.
 */
export function collectOutgoingFileLinks(
  markdown: string,
  sourceFilePath: string,
  vaultFilePaths: string[]
): OutgoingFileLink[] {
  const links: OutgoingFileLink[] = [];
  const seenHrefs = new Set<string>();

  for (const href of extractMarkdownLinkHrefs(markdown)) {
    if (!isFileLinkHref(href) || seenHrefs.has(href)) {
      continue;
    }

    seenHrefs.add(href);

    const targetFilePath = resolveFileLinkTarget(href, sourceFilePath, vaultFilePaths);

    if (targetFilePath === sourceFilePath) {
      continue;
    }

    links.push({ href, targetFilePath });
  }

  return links;
}

export type BacklinkSource = {
  filePath: string;
  markdown: string;
};

export type Backlink = {
  filePath: string;
  /** How many links of that note point here. */
  count: number;
};

/** Every note of the vault that links to `targetFilePath`. */
export function collectBacklinks(
  targetFilePath: string,
  sources: BacklinkSource[],
  vaultFilePaths: string[]
): Backlink[] {
  const backlinks: Backlink[] = [];

  for (const source of sources) {
    if (source.filePath === targetFilePath) {
      continue;
    }

    let count = 0;

    for (const href of extractMarkdownLinkHrefs(source.markdown)) {
      if (!isFileLinkHref(href)) {
        continue;
      }

      if (resolveFileLinkTarget(href, source.filePath, vaultFilePaths) === targetFilePath) {
        count += 1;
      }
    }

    if (count > 0) {
      backlinks.push({ filePath: source.filePath, count });
    }
  }

  return backlinks.sort((left, right) =>
    left.filePath.localeCompare(right.filePath, undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
}
