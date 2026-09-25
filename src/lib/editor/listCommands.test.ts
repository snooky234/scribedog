// Ctrl+Shift+Up/Down on list items. The interesting cases are the edges of a
// list: an item there must move past the neighbouring block on its own, not
// drag the whole list along. Needs a DOM for the editor view. Images are used
// as neighbours in the real app, but jsdom drops them on parse, so the tests
// use code blocks and quotes instead — any non-list block behaves the same.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { EditorImage } from "@/lib/editor/extensions/image";
import { moveLine, moveListItem } from "@/lib/editor/listCommands";

let editor: Editor | null = null;

function open(markdown: string, cursorText: string): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPreviewExtensions(),
    content: markdown
  });

  let pos = -1;
  editor.state.doc.descendants((node, nodePos) => {
    if (pos === -1 && node.isText && node.text?.includes(cursorText)) {
      pos = nodePos + node.text.indexOf(cursorText) + 1;
    }
    return pos === -1;
  });
  if (pos === -1) {
    throw new Error(`text "${cursorText}" not found`);
  }
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));

  return editor;
}

function markdownOf(current: Editor): string {
  const storage = current.storage as { markdown?: { getMarkdown?: () => string } };
  return (storage.markdown?.getMarkdown?.() ?? "").trim();
}

function textAtCursor(current: Editor): string {
  return current.state.selection.$from.parent.textContent;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("moveListItem", () => {
  it("swaps with the sibling inside the list", () => {
    const e = open("- one\n- two\n- three\n", "two");

    expect(moveListItem(e.view, "up")).toBe(true);

    expect(markdownOf(e)).toBe("- two\n- one\n- three");
    expect(textAtCursor(e)).toBe("two");
  });

  it("moves the last item past a code block and joins the list behind it", () => {
    const e = open("- one\n- two\n\n```\ncode\n```\n\n- three\n", "two");

    expect(moveListItem(e.view, "down")).toBe(true);

    expect(markdownOf(e)).toBe("- one\n\n```\ncode\n```\n\n- two\n- three");
    expect(textAtCursor(e)).toBe("two");
  });

  it("moves the first item above a blockquote and keeps the rest of the list", () => {
    const e = open("> quote\n\n- [x] first\n- [ ] second\n", "first");

    expect(moveListItem(e.view, "up")).toBe(true);

    expect(markdownOf(e)).toBe("- [x] first\n\n> quote\n\n- [ ] second");
    expect(textAtCursor(e)).toBe("first");
  });

  it("joins an adjacent list of the same type directly", () => {
    // Different markers make two separate lists in CommonMark.
    const e = open("- one\n\n* two\n* three\n", "two");
    expect(e.state.doc.child(0).childCount).toBe(1);
    expect(e.state.doc.child(1).type.name).toBe("bulletList");

    expect(moveListItem(e.view, "up")).toBe(true);

    expect(e.state.doc.child(0).childCount).toBe(2);
    expect(e.state.doc.child(0).textContent).toBe("onetwo");
    expect(e.state.doc.child(1).textContent).toBe("three");
    expect(textAtCursor(e)).toBe("two");
  });

  it("removes the list when its only item leaves it", () => {
    const e = open("Intro\n\n- only\n", "only");

    expect(moveListItem(e.view, "up")).toBe(true);

    expect(markdownOf(e)).toBe("- only\n\nIntro");
  });

  it("takes the nested sub-list along", () => {
    const e = open("- parent\n  - child\n\nAfter\n", "parent");

    expect(moveListItem(e.view, "down")).toBe(true);

    expect(markdownOf(e)).toBe("After\n\n- parent\n  - child");
    expect(textAtCursor(e)).toBe("parent");
  });

  it("does nothing at the end of the document but still consumes the key", () => {
    const e = open("- one\n- two\n", "two");
    const before = e.getJSON();

    expect(moveListItem(e.view, "down")).toBe(true);

    expect(e.getJSON()).toEqual(before);
  });

  it("does not move a nested item out of its sub-list", () => {
    const e = open("- parent\n  - child\n\nAfter\n", "child");
    const before = e.getJSON();

    expect(moveListItem(e.view, "down")).toBe(true);

    expect(e.getJSON()).toEqual(before);
  });
});

describe("moveLine", () => {
  it("moves a paragraph past the neighbouring block", () => {
    const e = open("First\n\nSecond\n", "First");

    expect(moveLine(e.view, "down")).toBe(true);

    expect(markdownOf(e)).toBe("Second\n\nFirst");
  });

  // Built from JSON: jsdom drops images when it parses markdown.
  function openWithSelectedImage(): Editor {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [...buildPreviewExtensions(), EditorImage],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Before" }] },
          { type: "image", attrs: { src: "images/eye.png", alt: "eye" } },
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }
        ]
      }
    });

    let imagePos = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "image") {
        imagePos = offset;
      }
    });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)));

    return editor;
  }

  function childTypes(current: Editor): string[] {
    const types: string[] = [];
    current.state.doc.forEach((node) => types.push(node.type.name));
    return types;
  }

  it("moves a selected image down and keeps it selected", () => {
    const e = openWithSelectedImage();

    expect(moveLine(e.view, "down")).toBe(true);

    expect(childTypes(e).slice(0, 3)).toEqual(["paragraph", "heading", "image"]);
    const { selection } = e.state;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.type.name).toBe("image");
  });

  it("moves a selected image up and keeps it selected", () => {
    const e = openWithSelectedImage();

    expect(moveLine(e.view, "up")).toBe(true);

    expect(childTypes(e).slice(0, 3)).toEqual(["image", "paragraph", "heading"]);
    const { selection } = e.state;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.type.name).toBe("image");
  });
});
