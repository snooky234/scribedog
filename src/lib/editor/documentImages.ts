import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { normalizeImageSrc } from "@/lib/chat/imageAttachments";

// An image is an atom node with no text, so it exists in two places that never
// meet: as a node in the document, and as ![alt](path) in whatever markdown a
// model writes. These helpers connect the two — used to place an insertion
// relative to an image (insertAnchor.ts) and to catch a proposal that would
// embed an image the document already carries (see Editor.tsx).

// Tolerant on purpose: models write the title/size part ("images/a.png \"w=300\""),
// wrap the target in angle brackets, or pad it with spaces.
const IMAGE_MARKDOWN = /!\[[^\]]*\]\(\s*<?([^()<>\s]+)>?[^)]*\)/g;

/** Every image src embedded in a piece of Markdown, normalized, in order. */
export function imageSourcesInMarkdown(markdown: string): string[] {
  const sources: string[] = [];

  for (const match of markdown.matchAll(IMAGE_MARKDOWN)) {
    const src = normalizeImageSrc(match[1]);

    if (src && !sources.includes(src)) {
      sources.push(src);
    }
  }

  return sources;
}

/** Position of the first image node with that src, or null. */
export function findImagePosition(doc: ProseMirrorNode, src: string): number | null {
  const target = normalizeImageSrc(src);
  let position: number | null = null;

  doc.descendants((node, pos) => {
    if (position !== null) {
      return false;
    }

    if (node.type.name === "image" && normalizeImageSrc((node.attrs.src as string | null) ?? "") === target) {
      position = pos;
      return false;
    }

    return true;
  });

  return position;
}

/** The srcs of the image nodes inside [from, to). */
export function imageSourcesInRange(doc: ProseMirrorNode, from: number, to: number): string[] {
  const sources: string[] = [];

  doc.nodesBetween(Math.min(from, to), Math.max(from, to), (node) => {
    if (node.type.name === "image") {
      const src = normalizeImageSrc((node.attrs.src as string | null) ?? "");

      if (src) {
        sources.push(src);
      }
    }

    return true;
  });

  return sources;
}

/**
 * The images a proposal would add a *second* copy of: embedded in the proposed
 * Markdown, already in the document, and not inside the range the proposal
 * replaces.
 *
 * This is the "the image got duplicated" case: asked to write below an image,
 * a model happily copies the surrounding markdown — heading, image, caption —
 * into its new_text, but the range it replaces only ever covered text (no text
 * search can match an image), so the copy lands next to the original instead of
 * over it.
 */
export function duplicatedImageSources(
  doc: ProseMirrorNode,
  markdown: string,
  from: number,
  to: number
): string[] {
  const proposed = imageSourcesInMarkdown(markdown);

  if (proposed.length === 0) {
    return [];
  }

  const replaced = new Set(imageSourcesInRange(doc, from, to));

  return proposed.filter((src) => !replaced.has(src) && findImagePosition(doc, src) !== null);
}
