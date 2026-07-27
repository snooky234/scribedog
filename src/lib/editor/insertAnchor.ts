import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { normalizeImageSrc } from "@/lib/chat/imageAttachments";
import { findImagePosition } from "@/lib/editor/documentImages";
import { findTextRange } from "@/lib/editor/textSearch";

// Where a proposed insertion actually goes.
//
// insert_at_cursor used to have exactly one answer to that: the editor's
// caret. But the user asking for the insertion is typing in the chat panel,
// so the caret is wherever they last clicked in the document — usually the
// top, and never the place they just described ("write a poem below the
// image"). The model then sees its text land in the wrong spot, tries again,
// and a second proposal stacks on the first.
//
// So the agent may name the place instead: a short passage the new text
// should follow, or the image it belongs under.

// A model names an image as the bare path, as the full markdown, or with the
// alt text in front of it — all three mean the node, which no text search can
// ever find (an image is an atom node carrying no text).
const IMAGE_MARKDOWN = /!\[[^\]]*\]\(\s*<?([^()<>\s]+)>?[^)]*\)/;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif)$/i;

/** The image src an anchor names, or null when it names text. */
export function extractImageAnchor(anchor: string): string | null {
  const asMarkdown = IMAGE_MARKDOWN.exec(anchor);

  if (asMarkdown) {
    return normalizeImageSrc(asMarkdown[1]);
  }

  const trimmed = anchor.trim();

  return !/\s/.test(trimmed) && IMAGE_EXTENSION.test(trimmed) ? normalizeImageSrc(trimmed) : null;
}

/**
 * The position right after the top-level block containing `pos` — an insertion
 * belongs *between* blocks, not inside the paragraph the anchor happens to sit
 * in.
 */
function afterTopLevelBlock(doc: ProseMirrorNode, pos: number): number {
  const clamped = Math.min(Math.max(pos, 0), doc.content.size);
  const $pos = doc.resolve(clamped);

  return $pos.depth === 0 ? clamped : $pos.after(1);
}

/**
 * Whether this document holds anything an anchor could ever name — any text, or
 * an image. A note the user just created holds neither.
 *
 * That case has to be kept apart from "the anchor was not found": the agent is
 * told to always say where new text goes (rule 6 of the system prompt), so on a
 * fresh note it passes an anchor taken from the chat — the attached file, its
 * own earlier answer — and every one of them comes back unresolvable. The
 * insertion then never happens and the model concludes it cannot write into an
 * empty note at all. There is exactly one place text can go in a document with
 * no content, so here the anchor is moot rather than wrong.
 */
export function hasAnchorableContent(doc: ProseMirrorNode): boolean {
  if (doc.textContent.trim()) {
    return true;
  }

  let hasImage = false;

  doc.descendants((node) => {
    if (node.type.name === "image") {
      hasImage = true;
    }

    return !hasImage;
  });

  return hasImage;
}

/**
 * Resolves an anchor to the position the new text goes after. Returns null
 * when the anchor names nothing in this document — the caller reports that
 * back to the model rather than silently falling back to the caret, which is
 * how the text ended up in the wrong place to begin with.
 */
export function resolveInsertAnchor(doc: ProseMirrorNode, anchor: string): number | null {
  if (!anchor.trim()) {
    return null;
  }

  const imageSrc = extractImageAnchor(anchor);

  if (imageSrc) {
    const imagePosition = findImagePosition(doc, imageSrc);

    // +1 puts the probe behind the image itself, so a top-level image resolves
    // to the position after it instead of the one before.
    return imagePosition === null ? null : afterTopLevelBlock(doc, imagePosition + 1);
  }

  const found = findTextRange(doc, 0, doc.content.size, anchor);

  return found ? afterTopLevelBlock(doc, found.to) : null;
}
