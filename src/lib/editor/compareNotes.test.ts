import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { collectCompareBlocks, compareDocuments, diffBlockKeys, classifyCompareHunk } from "./compareNotes";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    heading: { group: "block", content: "text*", attrs: { level: { default: 1 } } },
    bulletList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph+" },
    image: { group: "block", attrs: { src: { default: "" } } },
    horizontalRule: { group: "block" },
    text: {}
  }
});

const p = (text: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
const h = (text: string, level = 1) => schema.node("heading", { level }, [schema.text(text)]);
const doc = (...blocks: ProseMirrorNode[]) => schema.node("doc", null, blocks);

describe("diffBlockKeys", () => {
  it("finds nothing in equal notes", () => {
    expect(diffBlockKeys(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("reports a block only the compared note has", () => {
    expect(diffBlockKeys(["a", "b", "c"], ["a", "c"])).toEqual([{ refStart: 1, refEnd: 2, mainStart: 1, mainCount: 0 }]);
  });

  it("reports blocks only the open note has as a gap in front of the next block", () => {
    expect(diffBlockKeys(["a", "c"], ["a", "x", "y", "c"])).toEqual([{ refStart: 1, refEnd: 1, mainStart: 1, mainCount: 2 }]);
  });

  it("keeps a replaced block and its replacement in one hunk", () => {
    expect(diffBlockKeys(["a", "b", "c"], ["a", "B", "c"])).toEqual([{ refStart: 1, refEnd: 2, mainStart: 1, mainCount: 1 }]);
  });

  it("separates differences with equal blocks between them", () => {
    expect(diffBlockKeys(["a", "b", "c", "d"], ["x", "b", "c", "y"])).toHaveLength(2);
  });

  it("handles an empty side", () => {
    expect(diffBlockKeys([], ["a"])).toEqual([{ refStart: 0, refEnd: 0, mainStart: 0, mainCount: 1 }]);
    expect(diffBlockKeys(["a"], [])).toEqual([{ refStart: 0, refEnd: 1, mainStart: 0, mainCount: 0 }]);
  });
});

describe("collectCompareBlocks", () => {
  it("skips empty paragraphs and descends into lists", () => {
    const blocks = collectCompareBlocks(
      doc(
        p("One"),
        p(""),
        schema.node("bulletList", null, [schema.node("listItem", null, [p("Item")])]),
        schema.node("image", { src: "images/a.png" }),
        schema.node("horizontalRule")
      )
    );

    expect(blocks.map((block) => block.key)).toEqual([
      "paragraph:one",
      "paragraph:item",
      "image:images/a.png",
      "[horizontalRule]"
    ]);
  });

  it("tells a heading from a paragraph and heading levels apart", () => {
    const keys = collectCompareBlocks(doc(h("Title"), h("Title", 2), p("Title"))).map((block) => block.key);

    expect(new Set(keys).size).toBe(3);
  });

  it("gives positions that address the block node", () => {
    const value = doc(p("One"), p("Two"));
    const [, second] = collectCompareBlocks(value);

    expect(value.nodeAt(second.from)?.textContent).toBe("Two");
    expect(second.to - second.from).toBe(value.nodeAt(second.from)?.nodeSize);
  });
});

describe("compareDocuments", () => {
  it("ignores case and spacing differences", () => {
    const { hunks } = compareDocuments(doc(p("Hello   World")), doc(p("hello world")));

    expect(hunks).toEqual([]);
  });

  it("marks what the open note lacks", () => {
    const { refBlocks, hunks } = compareDocuments(
      doc(h("Task"), p("Explain the idea."), p("Give an example.")),
      doc(h("Task"), p("Explain the idea."))
    );

    expect(hunks).toEqual([{ refStart: 2, refEnd: 3, mainStart: 2, mainCount: 0, kinds: ["missing"], extra: 0 }]);
    expect(refBlocks[2].key).toBe("paragraph:give an example.");
  });
});

describe("classifyCompareHunk", () => {
  const hunk = (refStart: number, refEnd: number, mainStart: number, mainCount: number) => ({
    refStart,
    refEnd,
    mainStart,
    mainCount
  });

  it("treats a reworded paragraph as changed, not as missing plus extra", () => {
    expect(classifyCompareHunk(hunk(0, 1, 0, 1), ["paragraph:old"], ["paragraph:new"])).toMatchObject({
      kinds: ["changed"],
      extra: 0
    });
  });

  it("pairs a heading with a paragraph, both being text", () => {
    expect(classifyCompareHunk(hunk(0, 1, 0, 1), ["heading2:title"], ["paragraph:title!"]).kinds).toEqual(["changed"]);
  });

  it("does not pair an image with a paragraph", () => {
    expect(classifyCompareHunk(hunk(0, 1, 0, 1), ["image:a.png"], ["paragraph:text"])).toMatchObject({
      kinds: ["missing"],
      extra: 1
    });
  });

  it("keeps the rest of an uneven hunk as missing or extra", () => {
    const refKeys = ["paragraph:a", "paragraph:b", "paragraph:c"];

    expect(classifyCompareHunk(hunk(0, 3, 0, 1), refKeys, ["paragraph:x"])).toMatchObject({
      kinds: ["changed", "missing", "missing"],
      extra: 0
    });
    expect(classifyCompareHunk(hunk(0, 1, 0, 3), ["paragraph:a"], ["paragraph:x", "paragraph:y", "paragraph:z"]).extra).toBe(2);
  });

  it("reads the open note's blocks from the hunk's own start", () => {
    const kinds = classifyCompareHunk(hunk(1, 2, 1, 1), ["paragraph:same", "image:a.png"], ["paragraph:same", "image:b.png"]).kinds;

    expect(kinds).toEqual(["changed"]);
  });

  it("reports a pure insertion as extra only", () => {
    expect(classifyCompareHunk(hunk(5, 5, 5, 2), [], [])).toMatchObject({ kinds: [], extra: 2 });
  });
});
