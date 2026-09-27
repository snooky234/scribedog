import type { Editor as TipTapEditor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { getEditorMarkdown } from "@/lib/editor/markdownStorage";
import {
  locateNodeLines,
  type EditorNodeLines,
  type InnerMark,
  type InnerResolver
} from "@/lib/editor/pageLineMapping";

type MarkdownSerializer = { serialize: (content: unknown) => string };

// Each top-level node on its own, so its lines can be found in the whole
// document's markdown (pageLineMapping.ts).
export function serializeTopLevelNodes(editor: TipTapEditor): { markdown: string; nodes: EditorNodeLines[] } {
  const serializer = (editor.storage as { markdown?: { serializer?: MarkdownSerializer } }).markdown?.serializer;
  const { doc, schema } = editor.state;
  const markdown = getEditorMarkdown(editor, "");
  const pieces: string[] = [];
  const ranges: Array<{ pos: number; end: number }> = [];

  doc.forEach((node, offset) => {
    let piece = "";

    try {
      piece = serializer?.serialize(schema.topNodeType.create(null, node)) ?? "";
    } catch {
      // An unserializable node gets no page line; the rest still do.
    }

    pieces.push(piece);
    ranges.push({ pos: offset, end: offset + node.nodeSize });
  });

  const nodes = locateNodeLines(markdown, pieces).flatMap((lines, index) =>
    lines ? [{ ...ranges[index], ...lines }] : []
  );

  return { markdown, nodes };
}

/**
 * Finds the exact place of a planned page start inside a top-level node of
 * `doc`: offsets count characters the way the export's paragraph text does
 * (pagePlan.paragraphText), where a line break or an image is one character,
 * and rows and items count from the node's first child.
 */
export function createInnerResolver(doc: ProseMirrorNode): InnerResolver {
  return (node, at) => {
    const target = doc.nodeAt(node.pos);

    if (!target) {
      return null;
    }

    switch (at.kind) {
      case "paragraph":
        return textPosition(target, node.pos, at.offset);
      case "codeLine": {
        const lines = target.textContent.split("\n");

        if (!target.type.spec.code || at.line >= lines.length) {
          return null;
        }

        const offset = lines.slice(0, at.line).reduce((sum, line) => sum + line.length + 1, 0);
        return { kind: "inline", pos: node.pos + 1 + offset };
      }
      case "tableRow":
      case "listItem": {
        const index = at.kind === "tableRow" ? at.row : at.item;

        if (index >= target.childCount) {
          return null;
        }

        let pos = node.pos + 1;

        for (let child = 0; child < index; child++) {
          pos += target.child(child).nodeSize;
        }

        const row = target.child(index);
        // The label goes on the row's last cell (a <tr> draws nothing of its own).
        const labelPos = at.kind === "tableRow" && row.childCount > 0 ? pos + row.nodeSize - 1 - row.lastChild!.nodeSize : pos;
        const labelEnd = at.kind === "tableRow" && row.childCount > 0 ? pos + row.nodeSize - 1 : pos + row.nodeSize;

        return { kind: "before", pos, end: pos + row.nodeSize, labelPos, labelEnd };
      }
      default:
        return null;
    }
  };
}

// The document position at character `offset` of a textblock's text.
function textPosition(block: ProseMirrorNode, blockPos: number, offset: number): InnerMark | null {
  if (!block.isTextblock) {
    return null;
  }

  let consumed = 0;
  let found: number | null = null;

  block.forEach((child, childOffset) => {
    if (found !== null) {
      return;
    }

    const length = child.isText ? (child.text ?? "").length : 1;

    if (offset <= consumed + length && child.isText) {
      found = blockPos + 1 + childOffset + (offset - consumed);
    } else if (offset === consumed) {
      found = blockPos + 1 + childOffset;
    }

    consumed += length;
  });

  return found === null ? null : { kind: "inline", pos: found };
}
