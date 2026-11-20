// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import {
  clearPlacemarks,
  jumpToPlacemark,
  listPlacemarks,
  loadPlacemarks,
  Placemarks,
  placemarkRevealRequest,
  removePlacemark,
  removedPlacemark,
  restoreRemovedPlacemark,
  setOrRevealPlacemarkAt,
  setPlacemarkComment,
  togglePlacemarkAtSelection
} from "@/lib/editor/placemarkPlugin";
import { usePlacemarksStore } from "@/store/usePlacemarksStore";

vi.mock("@/lib/vaultMeta", () => ({
  readPlacemarks: vi.fn(async () => ({ version: 1, files: {} })),
  writePlacemarks: vi.fn(async () => undefined)
}));

vi.mock("@/lib/fileSystem", () => ({
  getRelativeDisplayPath: (root: string, filePath: string) => filePath.slice(root.length + 1)
}));

const VAULT = "/vault";
const FILE = { vaultPath: VAULT, relativePath: "notes/a.md" };

let editor: Editor | null = null;

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function createEditor(...texts: string[]): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [...buildPreviewExtensions(), Placemarks],
    content: { type: "doc", content: texts.map(paragraph) }
  });

  return editor;
}

/** Position right before the top-level block at `index`. */
function blockStart(target: Editor, index: number): number {
  let pos = 0;

  for (let i = 0; i < index; i += 1) {
    pos += target.state.doc.child(i).nodeSize;
  }

  return pos;
}

function storedAnchors() {
  return usePlacemarksStore.getState().getFileAnchors(VAULT, FILE.relativePath);
}

beforeEach(async () => {
  // jsdom has no layout, and no scrollIntoView with it.
  HTMLElement.prototype.scrollIntoView = vi.fn();
  usePlacemarksStore.setState({ vaultPath: null, files: {} });
  await usePlacemarksStore.getState().ensureLoaded(VAULT);
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("placemark plugin", () => {
  it("resolves stored marks and follows its block through an edit above it", () => {
    const target = createEditor("One", "Two", "Three");
    loadPlacemarks(target, FILE, [{ block: 2, quote: "Three", comment: "look again" }]);

    expect(listPlacemarks(target.state).map((mark) => [mark.blockNumber, mark.quote, mark.comment])).toEqual([
      [3, "Three", "look again"]
    ]);

    target.commands.insertContentAt(0, paragraph("New first"));

    expect(listPlacemarks(target.state).map((mark) => mark.quote)).toEqual(["Three"]);
    expect(storedAnchors()).toEqual([{ block: 3, quote: "Three", comment: "look again" }]);
  });

  it("toggles the mark of the cursor's block and stores comments", () => {
    const target = createEditor("One", "Two");
    loadPlacemarks(target, FILE, []);
    target.commands.setTextSelection(blockStart(target, 1) + 2);

    togglePlacemarkAtSelection(target);
    const [mark] = listPlacemarks(target.state);
    expect(mark.blockNumber).toBe(2);

    setPlacemarkComment(target, mark.pos, "  continue here  ");
    expect(storedAnchors()).toEqual([{ block: 1, quote: "Two", comment: "continue here" }]);

    togglePlacemarkAtSelection(target);
    expect(listPlacemarks(target.state)).toEqual([]);
    expect(storedAnchors()).toEqual([]);
  });

  it("sets a mark from the gutter, and on a marked block asks for it instead of removing it", () => {
    const target = createEditor("One", "Two");
    loadPlacemarks(target, FILE, []);
    const requests: Array<number | null> = [];
    target.on("transaction", ({ transaction }) => requests.push(placemarkRevealRequest(transaction)));

    setOrRevealPlacemarkAt(target.view, blockStart(target, 1) + 2);
    expect(listPlacemarks(target.state).map((mark) => mark.blockNumber)).toEqual([2]);
    expect(requests).toEqual([null]);

    setOrRevealPlacemarkAt(target.view, blockStart(target, 1) + 1);
    expect(listPlacemarks(target.state).map((mark) => mark.blockNumber)).toEqual([2]);
    expect(requests).toEqual([null, blockStart(target, 1)]);
  });

  it("keeps a mark removed with its comment so it can be put back where its block went", () => {
    const target = createEditor("One", "Two");
    loadPlacemarks(target, FILE, [{ block: 1, quote: "Two", comment: "continue here" }]);
    const [mark] = listPlacemarks(target.state);

    removePlacemark(target, mark.pos);
    expect(listPlacemarks(target.state)).toEqual([]);
    expect(removedPlacemark(target.state)?.comment).toBe("continue here");

    target.commands.insertContentAt(0, paragraph("New first"));
    restoreRemovedPlacemark(target);

    expect(removedPlacemark(target.state)).toBeNull();
    expect(storedAnchors()).toEqual([{ block: 2, quote: "Two", comment: "continue here" }]);
  });

  it("offers no undo for a mark without a comment, and forgets the offer with the note", () => {
    const target = createEditor("One", "Two");
    loadPlacemarks(target, FILE, [{ block: 0, quote: "One" }, { block: 1, quote: "Two", comment: "note" }]);
    const [plain, commented] = listPlacemarks(target.state);

    removePlacemark(target, plain.pos);
    expect(removedPlacemark(target.state)).toBeNull();

    removePlacemark(target, commented.pos);
    expect(removedPlacemark(target.state)).not.toBeNull();

    clearPlacemarks(target);
    expect(removedPlacemark(target.state)).toBeNull();
  });

  it("does nothing and reports nothing once detached from its note", () => {
    const target = createEditor("One", "Two");
    loadPlacemarks(target, FILE, [{ block: 0, quote: "One" }]);
    clearPlacemarks(target);

    expect(togglePlacemarkAtSelection(target)).toBe(false);
    target.commands.insertContentAt(0, paragraph("Other note"));

    expect(listPlacemarks(target.state)).toEqual([]);
    expect(storedAnchors()).toEqual([{ block: 0, quote: "One" }]);
  });

  it("jumps between marks and wraps around", () => {
    const target = createEditor("A", "B", "C", "D");
    loadPlacemarks(target, FILE, [
      { block: 1, quote: "B" },
      { block: 3, quote: "D" }
    ]);
    target.commands.setTextSelection(1);

    const currentBlock = () => target.state.doc.resolve(target.state.selection.from).parent.textContent;

    jumpToPlacemark(target, 1);
    expect(currentBlock()).toBe("B");
    jumpToPlacemark(target, 1);
    expect(currentBlock()).toBe("D");
    jumpToPlacemark(target, 1);
    expect(currentBlock()).toBe("B");
    jumpToPlacemark(target, -1);
    expect(currentBlock()).toBe("D");
  });

  it("stays with the text when Enter splits off an empty block above it", () => {
    const target = createEditor("One", "Two");
    loadPlacemarks(target, FILE, [{ block: 1, quote: "Two" }]);

    target.commands.setTextSelection(blockStart(target, 1) + 1);
    target.commands.splitBlock();

    expect(listPlacemarks(target.state).map((mark) => [mark.blockNumber, mark.quote])).toEqual([[3, "Two"]]);
  });

  it("merges two marks whose blocks were joined", () => {
    const target = createEditor("One", "Two");
    loadPlacemarks(target, FILE, [
      { block: 0, quote: "One" },
      { block: 1, quote: "Two", comment: "kept" }
    ]);

    // Deleting the boundary joins "Two" into "One".
    const end = blockStart(target, 1);
    target.commands.deleteRange({ from: end - 1, to: end + 1 });

    expect(listPlacemarks(target.state).map((mark) => [mark.quote, mark.comment])).toEqual([["OneTwo", "kept"]]);
  });
});
