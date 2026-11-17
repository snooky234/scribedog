// Markdown round trip, tolerant reading, commands and the view state of the
// expandable section (<details>). Parsing goes through markdown-it and a DOM,
// hence the jsdom environment.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";

import { detailsViewKey, encodeSummary, toggleDetailsView } from "./details";

const editors: Editor[] = [];

function createEditor(content: string): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPreviewExtensions(),
    content
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? "";
}

function topLevelTypes(editor: Editor): string[] {
  const types: string[] = [];
  editor.state.doc.forEach((node) => types.push(node.type.name));
  return types;
}

function firstDetails(editor: Editor) {
  let found: { pos: number; node: import("@tiptap/pm/model").Node } | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === "details") {
      found = { pos, node };
    }
  });

  if (!found) {
    throw new Error("no details node");
  }

  return found as { pos: number; node: import("@tiptap/pm/model").Node };
}

function isCollapsed(editor: Editor, pos: number): boolean {
  const set = detailsViewKey.getState(editor.state);
  const marker = set?.find(pos, pos + 1).find((decoration) => decoration.from === pos);
  return Boolean((marker?.spec as { collapsed?: boolean } | undefined)?.collapsed);
}

const CANONICAL = "<details>\n<summary>Title</summary>\n\nSome **bold** text\n\n- one\n- two\n\n</details>";

describe("details markdown", () => {
  it("reads the canonical form and writes it back unchanged", () => {
    const editor = createEditor(CANONICAL);
    const { node } = firstDetails(editor);

    expect(node.attrs.open).toBe(false);
    expect(node.child(0).type.name).toBe("detailsSummary");
    expect(node.child(0).textContent).toBe("Title");
    expect(node.child(1).type.name).toBe("paragraph");
    expect(node.child(2).type.name).toBe("bulletList");
    expect(getMarkdown(editor)).toBe(CANONICAL);
  });

  it("keeps the open attribute", () => {
    const markdown = "<details open>\n<summary>Title</summary>\n\ntext\n\n</details>";
    const editor = createEditor(markdown);

    expect(firstDetails(editor).node.attrs.open).toBe(true);
    expect(getMarkdown(editor)).toBe(markdown);
  });

  it("reads the tolerant spellings and writes the canonical one", () => {
    const editor = createEditor('<DETAILS open="">\n<summary>Title</summary>\ntext\n</details>');

    expect(firstDetails(editor).node.attrs.open).toBe(true);
    expect(getMarkdown(editor)).toBe("<details open>\n<summary>Title</summary>\n\ntext\n\n</details>");
  });

  it("reads a summary on the details line", () => {
    const editor = createEditor("<details><summary>Title</summary>\n\ntext\n\n</details>");

    expect(firstDetails(editor).node.child(0).textContent).toBe("Title");
    expect(getMarkdown(editor)).toBe("<details>\n<summary>Title</summary>\n\ntext\n\n</details>");
  });

  it("writes no summary line for an empty title", () => {
    const markdown = "<details>\n\ntext\n\n</details>";
    const editor = createEditor(markdown);

    expect(firstDetails(editor).node.child(0).textContent).toBe("");
    expect(getMarkdown(editor)).toBe(markdown);
  });

  it("keeps an empty section stable", () => {
    const markdown = "<details>\n<summary>Title</summary>\n\n</details>";
    const editor = createEditor(markdown);
    const saved = getMarkdown(editor);

    editor.commands.setContent(saved);

    expect(getMarkdown(editor)).toBe(saved);
    expect(topLevelTypes(editor)[0]).toBe("details");
  });

  it("decodes entities in the summary and escapes only what HTML would read as markup", () => {
    const editor = createEditor("<details>\n<summary>Q&amp;A &lt;b&gt; &copy;</summary>\n\ntext\n\n</details>");

    expect(firstDetails(editor).node.child(0).textContent).toBe("Q&A <b> ©");
    expect(getMarkdown(editor)).toContain("<summary>Q&A &lt;b> ©</summary>");
  });

  it("keeps Markdown in the summary as literal text", () => {
    const markdown = "<details>\n<summary>**not bold** and *this*</summary>\n\ntext\n\n</details>";
    const editor = createEditor(markdown);

    expect(firstDetails(editor).node.child(0).textContent).toBe("**not bold** and *this*");
    expect(getMarkdown(editor)).toBe(markdown);
  });

  it("round-trips nested sections", () => {
    const markdown = [
      "<details>",
      "<summary>Outer</summary>",
      "",
      "<details>",
      "<summary>Inner</summary>",
      "",
      "inner text",
      "",
      "</details>",
      "",
      "</details>"
    ].join("\n");
    const editor = createEditor(markdown);
    const outer = firstDetails(editor).node;

    expect(outer.child(1).type.name).toBe("details");
    expect(getMarkdown(editor)).toBe(markdown);
  });

  it("round-trips a section inside a list item", () => {
    const markdown = "- item\n\n  <details>\n  <summary>Title</summary>\n\n  text\n\n  </details>";
    const editor = createEditor(markdown);
    const saved = getMarkdown(editor);

    expect(firstDetails(editor).node.child(0).textContent).toBe("Title");

    editor.commands.setContent(saved);

    expect(getMarkdown(editor)).toBe(saved);
  });

  it("reads a list holding a section as loose, so the first save is already stable", () => {
    const editor = createEditor("- item\n  <details>\n  <summary>T</summary>\n\n  text\n\n  </details>\n- next");
    const saved = getMarkdown(editor);

    expect(saved).toBe("- item\n\n  <details>\n  <summary>T</summary>\n\n  text\n\n  </details>\n\n- next");

    editor.commands.setContent(saved);
    expect(getMarkdown(editor)).toBe(saved);
  });

  it("starts right below a paragraph line", () => {
    const editor = createEditor("intro\n<details>\n<summary>Title</summary>\n\ntext\n\n</details>");

    expect(topLevelTypes(editor).slice(0, 2)).toEqual(["paragraph", "details"]);
  });

  it.each([
    ["an unknown attribute", '<details class="x">\n<summary>Title</summary>\n\ntext\n\n</details>'],
    ["a tag in the summary", "<details>\n<summary><b>Title</b></summary>\n\ntext\n\n</details>"],
    ["a missing close", "<details>\n<summary>Title</summary>\n\ntext"],
    ["content on the details line", "<details>text</details>"]
  ])("leaves %s alone as text", (_label, markdown) => {
    const editor = createEditor(markdown);

    expect(topLevelTypes(editor)).not.toContain("details");
    expect(editor.state.doc.textContent).toContain(markdown.split("\n")[0]);

    // What any raw HTML has always become: stable from the first save on.
    const saved = getMarkdown(editor);
    editor.commands.setContent(saved);
    expect(getMarkdown(editor)).toBe(saved);
  });

  it("does not read a page break inside a section", () => {
    const editor = createEditor(
      '<details>\n<summary>Title</summary>\n\n<div style="page-break-after: always;"></div>\n\n</details>'
    );

    expect(editor.state.doc.toString()).not.toContain("pageBreak");
  });
});

describe("encodeSummary", () => {
  it("escapes only entity-like ampersands and tag-like brackets", () => {
    expect(encodeSummary("Q&A")).toBe("Q&A");
    expect(encodeSummary("&amp;")).toBe("&amp;amp;");
    expect(encodeSummary("a < b")).toBe("a < b");
    expect(encodeSummary("<b>")).toBe("&lt;b>");
    expect(encodeSummary("  two\n lines ")).toBe("two lines");
  });
});

describe("details view state", () => {
  it("starts collapsed or expanded by the open attribute", () => {
    const editor = createEditor(
      "<details>\n<summary>A</summary>\n\na\n\n</details>\n\n<details open>\n<summary>B</summary>\n\nb\n\n</details>"
    );
    const positions: number[] = [];

    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "details") {
        positions.push(offset);
      }
    });

    expect(isCollapsed(editor, positions[0])).toBe(true);
    expect(isCollapsed(editor, positions[1])).toBe(false);
  });

  it("toggles without changing the document", () => {
    const editor = createEditor(CANONICAL);
    // The first transaction adds the trailing empty paragraph on its own.
    editor.view.dispatch(editor.state.tr);
    const { pos } = firstDetails(editor);
    const before = editor.state.doc;
    let updates = 0;
    editor.on("update", () => {
      updates += 1;
    });

    toggleDetailsView(editor.view, pos);
    expect(isCollapsed(editor, pos)).toBe(false);

    toggleDetailsView(editor.view, pos);
    expect(isCollapsed(editor, pos)).toBe(true);

    expect(editor.state.doc.eq(before)).toBe(true);
    expect(updates).toBe(0);
    expect(getMarkdown(editor)).toBe(CANONICAL);
  });

  it("expands a collapsed section when the selection moves into its content", () => {
    const editor = createEditor(CANONICAL);
    const { pos, node } = firstDetails(editor);
    const contentStart = pos + 1 + node.child(0).nodeSize;

    expect(isCollapsed(editor, pos)).toBe(true);

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, contentStart + 1)));

    expect(isCollapsed(editor, pos)).toBe(false);
  });

  it("moves the selection out of the content when collapsing", () => {
    const editor = createEditor("<details open>\n<summary>Title</summary>\n\ntext\n\n</details>");
    const { pos, node } = firstDetails(editor);
    const contentStart = pos + 1 + node.child(0).nodeSize;

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, contentStart + 2)));
    toggleDetailsView(editor.view, pos);

    expect(isCollapsed(editor, pos)).toBe(true);
    expect(editor.state.selection.$head.parent.type.name).toBe("detailsSummary");
  });
});

describe("details commands", () => {
  it("wraps the current paragraph, expanded, with the caret in the summary", () => {
    const editor = createEditor("hello");

    editor.commands.setTextSelection(2);
    expect(editor.commands.setDetails()).toBe(true);

    const { pos, node } = firstDetails(editor);

    expect(node.child(1).textContent).toBe("hello");
    expect(editor.state.selection.$head.parent.type.name).toBe("detailsSummary");
    expect(isCollapsed(editor, pos)).toBe(false);
    expect(getMarkdown(editor)).toBe("<details>\n\nhello\n\n</details>");
  });

  it("puts an empty section below the first paragraph of a list item", () => {
    const editor = createEditor("- item");

    editor.commands.setTextSelection(4);
    expect(editor.commands.setDetails()).toBe(true);

    const listItem = editor.state.doc.child(0).child(0);
    expect(listItem.child(0).textContent).toBe("item");
    expect(listItem.child(1).type.name).toBe("details");
  });

  // Selects from the first occurrence of `from` to the end of `to`.
  function selectText(editor: Editor, from: string, to: string) {
    let start = -1;
    let end = -1;

    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        const a = node.text.indexOf(from);
        const b = node.text.indexOf(to);

        if (a >= 0 && start < 0) {
          start = pos + a;
        }

        if (b >= 0) {
          end = pos + b + to.length;
        }
      }
    });

    editor.commands.setTextSelection({ from: start, to: end });
  }

  it("moves selected list items into a section at their place in the list", () => {
    const editor = createEditor("- one\n- two\n- three\n- four");

    selectText(editor, "two", "three");
    expect(editor.commands.setDetails()).toBe(true);

    expect(topLevelTypes(editor).slice(0, 3)).toEqual(["bulletList", "details", "bulletList"]);
    expect(isCollapsed(editor, firstDetails(editor).pos)).toBe(false);
    expect(getMarkdown(editor)).toBe("- one\n\n<details>\n\n- two\n- three\n\n</details>\n\n- four");
  });

  it("moves the item of selected text inside one list item", () => {
    const editor = createEditor("- one\n- two words\n- three");

    selectText(editor, "two", "words");
    editor.commands.setDetails();

    expect(getMarkdown(editor)).toBe("- one\n\n<details>\n\n- two words\n\n</details>\n\n- three");
  });

  it("moves a whole selected list without leaving empty lists behind", () => {
    const editor = createEditor("- one\n- two");

    selectText(editor, "one", "two");
    editor.commands.setDetails();

    expect(topLevelTypes(editor)[0]).toBe("details");
    expect(getMarkdown(editor)).toBe("<details>\n\n- one\n- two\n\n</details>");
  });

  it("keeps the numbering of an ordered list going", () => {
    const editor = createEditor("1. one\n2. two\n3. three");

    selectText(editor, "two", "two");
    editor.commands.setDetails();

    expect(getMarkdown(editor)).toBe("1. one\n\n<details>\n\n2. two\n\n</details>\n\n3. three");
  });

  it("puts a section into the parent item for items of a nested list", () => {
    const editor = createEditor("- parent\n  - alpha\n  - beta\n- next");

    selectText(editor, "alpha", "alpha");
    editor.commands.setDetails();

    const parentItem = editor.state.doc.child(0).child(0);
    expect(parentItem.child(1).type.name).toBe("details");
    expect(editor.state.doc.child(0).childCount).toBe(2);

    const saved = getMarkdown(editor);
    editor.commands.setContent(saved);
    expect(getMarkdown(editor)).toBe(saved);
  });

  it("unwraps into the title paragraph and the content", () => {
    const editor = createEditor(CANONICAL);
    const { pos } = firstDetails(editor);

    editor.commands.setTextSelection(pos + 3);
    expect(editor.commands.unsetDetails()).toBe(true);

    expect(topLevelTypes(editor).slice(0, 3)).toEqual(["paragraph", "paragraph", "bulletList"]);
    expect(getMarkdown(editor)).toBe("Title\n\nSome **bold** text\n\n- one\n- two");
  });

  it("starts a new line at the top of the content on Enter in the summary", () => {
    const editor = createEditor("<details open>\n<summary>Title</summary>\n\ntext\n\n</details>");
    const { pos } = firstDetails(editor);

    editor.commands.setTextSelection(pos + 2 + "Title".length);
    const handled = editor.view.someProp("handleKeyDown", (handler) =>
      handler(editor.view, new KeyboardEvent("keydown", { key: "Enter" }))
    );
    expect(handled).toBe(true);
    editor.commands.insertContent("new");

    const { node } = firstDetails(editor);
    expect(node.child(0).textContent).toBe("Title");
    expect(node.child(1).textContent).toBe("new");
    expect(node.child(2).textContent).toBe("text");
  });

  it("stores the start state without changing the view", () => {
    const editor = createEditor(CANONICAL);
    const { pos } = firstDetails(editor);

    editor.commands.setTextSelection(pos + 3);
    editor.commands.setDetailsOpenByDefault(true);

    expect(firstDetails(editor).node.attrs.open).toBe(true);
    expect(isCollapsed(editor, pos)).toBe(true);
    expect(getMarkdown(editor).startsWith("<details open>\n")).toBe(true);
  });
});
