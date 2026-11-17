import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";

import { blockIndexAt, blockPositionOf, collectNumberedBlocks, formatBadgePosition } from "./blockPosition";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: { content: "inline*", group: "block", attrs: { level: { default: 1 } } },
    bulletList: { content: "listItem+", group: "block" },
    listItem: { content: "paragraph block*" },
    image: { group: "block", atom: true },
    inlineImage: { group: "inline", inline: true, atom: true },
    table: { content: "tableRow+", group: "block", tableRole: "table" },
    tableRow: { content: "tableCell+", tableRole: "row" },
    tableCell: { content: "paragraph+", tableRole: "cell" },
    text: { group: "inline" }
  }
});

const p = (text: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
const h = (text: string) => schema.node("heading", { level: 1 }, [schema.text(text)]);
const li = (...children: ReturnType<typeof p>[]) => schema.node("listItem", null, children);
const ul = (...items: ReturnType<typeof li>[]) => schema.node("bulletList", null, items);
const img = () => schema.node("image");
const table = () =>
  schema.node("table", null, [
    schema.node("tableRow", null, [schema.node("tableCell", null, [p("a")]), schema.node("tableCell", null, [p("b")])])
  ]);

describe("collectNumberedBlocks", () => {
  it("numbers textblocks, list item paragraphs and block leaves in document order", () => {
    const doc = schema.node("doc", null, [h("Title"), p("one"), ul(li(p("item"), ul(li(p("nested"))))), img()]);
    const names = collectNumberedBlocks(doc).map((block) => doc.nodeAt(block.pos)?.type.name);

    expect(names).toEqual(["heading", "paragraph", "paragraph", "paragraph", "image"]);
  });

  it("counts a table as one block, not one per cell", () => {
    const doc = schema.node("doc", null, [p("before"), table(), p("after")]);
    const names = collectNumberedBlocks(doc).map((block) => doc.nodeAt(block.pos)?.type.name);

    expect(names).toEqual(["paragraph", "table", "paragraph"]);
  });

  it("returns the same array for the same document", () => {
    const doc = schema.node("doc", null, [p("one")]);
    expect(collectNumberedBlocks(doc)).toBe(collectNumberedBlocks(doc));
  });
});

describe("blockIndexAt", () => {
  it("finds the block containing a position", () => {
    const doc = schema.node("doc", null, [p("ab"), p("cd")]);
    const blocks = collectNumberedBlocks(doc);

    expect(blockIndexAt(blocks, 0)).toBe(0);
    expect(blockIndexAt(blocks, 3)).toBe(0);
    expect(blockIndexAt(blocks, 4)).toBe(1);
    expect(blockIndexAt(blocks, -1)).toBe(-1);
  });
});

describe("blockPositionOf", () => {
  // p("hello") spans 0..7 (content 1..6), p("world") spans 7..14 (content 8..13).
  const doc = schema.node("doc", null, [p("hello"), p("world"), img()]);

  it("reports the block and a 1-based column for a cursor", () => {
    expect(blockPositionOf(doc, 1, 1)).toEqual({ total: 3, from: { block: 1, column: 1 }, to: null });
    expect(blockPositionOf(doc, 6, 6)).toEqual({ total: 3, from: { block: 1, column: 6 }, to: null });
    expect(blockPositionOf(doc, 10, 10)).toEqual({ total: 3, from: { block: 2, column: 3 }, to: null });
  });

  it("reports the first and last covered character of a selection", () => {
    expect(blockPositionOf(doc, 2, 5)).toEqual({
      total: 3,
      from: { block: 1, column: 2 },
      to: { block: 1, column: 4 }
    });
    expect(blockPositionOf(doc, 4, 10)).toEqual({
      total: 3,
      from: { block: 1, column: 4 },
      to: { block: 2, column: 2 }
    });
  });

  it("ends a selection that stops at the start of a block in the block before", () => {
    expect(blockPositionOf(doc, 1, 8)).toEqual({
      total: 3,
      from: { block: 1, column: 1 },
      to: { block: 1, column: 5 }
    });
  });

  it("gives a block without text no column", () => {
    expect(blockPositionOf(doc, 14, 15)?.from).toEqual({ block: 3, column: null });
  });

  it("counts an inline leaf as one character", () => {
    const withImage = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("ab"), schema.node("inlineImage"), schema.text("cd")])
    ]);

    // Positions: 1 a, 2 b, 3 image, 4 c, 5 d, 6 end.
    expect(blockPositionOf(withImage, 5, 5)?.from).toEqual({ block: 1, column: 5 });
  });

  it("puts the cursor of an empty paragraph at column 1", () => {
    const empty = schema.node("doc", null, [p("")]);
    expect(blockPositionOf(empty, 1, 1)?.from).toEqual({ block: 1, column: 1 });
  });
});

describe("formatBadgePosition", () => {
  const point = (block: number, column: number | null) => ({ block, column });

  it("shows the cursor's character", () => {
    expect(formatBadgePosition({ total: 9, from: point(7, 27), to: null })).toBe("27");
  });

  it("shows a range inside one block", () => {
    expect(formatBadgePosition({ total: 9, from: point(7, 41), to: point(7, 65) })).toBe("41–65");
  });

  it("shows where a range across blocks ends", () => {
    expect(formatBadgePosition({ total: 9, from: point(7, 27), to: point(8, 4) })).toBe("27 → 8:4");
    expect(formatBadgePosition({ total: 9, from: point(3, null), to: point(5, null) })).toBe("→ 5");
  });

  it("adds nothing for a block without text", () => {
    expect(formatBadgePosition({ total: 9, from: point(3, null), to: null })).toBeNull();
  });
});
