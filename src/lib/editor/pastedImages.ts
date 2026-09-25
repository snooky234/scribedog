import { Fragment, type Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";

import { adoptPastedImageSource } from "@/lib/clipboardImages";

function mapImageSources(fragment: Fragment, map: (src: string) => string): Fragment {
  let changed = false;
  const children: ProseMirrorNode[] = [];

  fragment.forEach((child) => {
    let next = child;

    if (child.type.name === "image") {
      const src = (child.attrs.src as string | null) ?? "";
      const nextSrc = src ? map(src) : src;

      if (nextSrc !== src) {
        next = child.type.create({ ...child.attrs, src: nextSrc }, child.content, child.marks);
      }
    } else if (child.childCount > 0) {
      const content = mapImageSources(child.content, map);

      if (content !== child.content) {
        next = child.copy(content);
      }
    }

    changed = changed || next !== child;
    children.push(next);
  });

  return changed ? Fragment.fromArray(children) : fragment;
}

/**
 * A pasted slice with the images the editor itself put on the clipboard
 * pointing where they should from `filePath` (see lib/clipboardImages.ts):
 * the references are relative to the note they were cut or copied from, and
 * pasted unchanged into a note in another folder they point at nothing.
 */
export function adoptPastedImages(slice: Slice, filePath: string | null, folderPath: string | null): Slice {
  const content = mapImageSources(slice.content, (src) => adoptPastedImageSource(src, filePath, folderPath));

  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}
