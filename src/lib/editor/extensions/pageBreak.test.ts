// Round trip and insert command of the page break node. Parsing goes through
// markdown-it and a DOM, hence the jsdom environment for this file.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { isPageBreakLine, PAGE_BREAK_MARKDOWN } from "@/lib/editor/extensions/pageBreak";

type JSONNode = { type?: string; text?: string; content?: JSONNode[] };

const editors: Editor[] = [];

function createEditor(markdown: string): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPreviewExtensions(),
    content: markdown
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
  return ((editor.getJSON() as JSONNode).content ?? []).map((node) => node.type ?? "");
}

function countPageBreaks(node: JSONNode): number {
  return (node.type === "pageBreak" ? 1 : 0) + (node.content ?? []).reduce((sum, child) => sum + countPageBreaks(child), 0);
}

function textOf(node: JSONNode): string {
  return node.text ?? (node.content ?? []).map(textOf).join("");
}

describe("isPageBreakLine", () => {
  it.each([
    '<div style="page-break-after: always;"></div>',
    '<div style="page-break-before: always"></div>',
    "<div style='break-after: page;'></div>",
    '<div style="break-before:page"></div>',
    '<DIV STYLE="PAGE-BREAK-AFTER: ALWAYS;"></DIV>',
    '<div style="color: red; page-break-after: always;"></div>',
    '   <div style="page-break-after: always;"></div>  '
  ])("accepts %s", (line) => {
    expect(isPageBreakLine(line)).toBe(true);
  });

  it.each([
    '<div style="page-break-after: always;"></div> and more',
    'Text <div style="page-break-after: always;"></div>',
    '<div style="page-break-after: avoid;"></div>',
    '<div style="break-after: column;"></div>',
    '<div class="page-break"></div>',
    '<div style="page-break-after: always;">text</div>',
    '    <div style="page-break-after: always;"></div>'
  ])("rejects %s", (line) => {
    expect(isPageBreakLine(line)).toBe(false);
  });
});

describe("page break markdown", () => {
  it("reads the canonical line as a page break node", () => {
    const editor = createEditor(`First\n\n${PAGE_BREAK_MARKDOWN}\n\nSecond\n`);

    expect(topLevelTypes(editor)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("writes every accepted spelling back in the canonical form", () => {
    const editor = createEditor("First\n\n<div style='break-before: page'></div>\n\nSecond\n");

    expect(getMarkdown(editor)).toBe(`First\n\n${PAGE_BREAK_MARKDOWN}\n\nSecond`);
  });

  it("round-trips unchanged", () => {
    const markdown = `# Title\n\nFirst\n\n${PAGE_BREAK_MARKDOWN}\n\n## Next\n\nSecond`;

    expect(getMarkdown(createEditor(markdown))).toBe(markdown);
  });

  it("recognizes a break directly after a paragraph's blank line only, not inside it", () => {
    const editor = createEditor(`First\n${PAGE_BREAK_MARKDOWN}\n`);

    expect(countPageBreaks(editor.getJSON() as JSONNode)).toBe(0);
  });

  it.each([
    ["a list", `- item\n\n  ${PAGE_BREAK_MARKDOWN}\n`],
    ["a quote", `> quote\n>\n> ${PAGE_BREAK_MARKDOWN}\n`],
    ["a callout", `> [!INFO]\n> ${PAGE_BREAK_MARKDOWN}\n`],
    ["a table", `| A |\n| --- |\n| ${PAGE_BREAK_MARKDOWN} |\n`],
    ["a code block", `\`\`\`\n${PAGE_BREAK_MARKDOWN}\n\`\`\`\n`]
  ])("is not recognized inside %s", (_label, markdown) => {
    const editor = createEditor(markdown);

    expect(countPageBreaks(editor.getJSON() as JSONNode)).toBe(0);
    expect(textOf(editor.getJSON() as JSONNode)).toContain("page-break-after");
  });

  it("keeps a line with extra text as text", () => {
    const line = `${PAGE_BREAK_MARKDOWN} more`;
    const editor = createEditor(`${line}\n`);

    expect(countPageBreaks(editor.getJSON() as JSONNode)).toBe(0);
    expect(getMarkdown(editor)).toBe(line);
  });
});

describe("setPageBreak", () => {
  function placeCursor(editor: Editor, text: string, offset: number) {
    let target = -1;

    editor.state.doc.descendants((node, pos) => {
      if (target === -1 && node.isText && node.text?.includes(text)) {
        target = pos + node.text.indexOf(text) + offset;
      }
    });

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)));
  }

  it("splits a paragraph at the cursor", () => {
    const editor = createEditor("Before after\n");
    placeCursor(editor, "after", 0);

    editor.commands.setPageBreak();

    // The space before the cursor stays where it was, as in a word processor.
    expect(getMarkdown(editor)).toBe(`Before \n\n${PAGE_BREAK_MARKDOWN}\n\nafter`);
    expect(editor.state.selection.$from.parent.textContent).toBe("after");
  });

  it("goes behind a paragraph when the cursor is at its end and opens an empty one", () => {
    const editor = createEditor("Only\n");
    placeCursor(editor, "Only", 4);

    editor.commands.setPageBreak();

    expect(topLevelTypes(editor)).toEqual(["paragraph", "pageBreak", "paragraph"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("");
  });

  it("goes in front of a heading when the cursor is at its start", () => {
    const editor = createEditor("Intro\n\n## Chapter\n\nText\n");
    placeCursor(editor, "Chapter", 0);

    editor.commands.setPageBreak();

    expect(topLevelTypes(editor)).toEqual(["paragraph", "pageBreak", "heading", "paragraph"]);
  });

  it("replaces an empty paragraph", () => {
    const editor = createEditor("First\n\nSecond\n");
    placeCursor(editor, "First", 5);
    editor.commands.splitBlock();

    editor.commands.setPageBreak();

    expect(topLevelTypes(editor)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("goes behind the top-level block when the cursor is nested", () => {
    const editor = createEditor("- one\n- two\n\nAfter\n");
    placeCursor(editor, "one", 1);

    editor.commands.setPageBreak();

    expect(topLevelTypes(editor)).toEqual(["bulletList", "pageBreak", "paragraph"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("After");
  });

  it("goes behind a selected top-level node", () => {
    const editor = createEditor(`A\n\n${PAGE_BREAK_MARKDOWN}\n\nB\n`);
    let breakPos = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "pageBreak") {
        breakPos = offset;
      }
    });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, breakPos)));

    editor.commands.setPageBreak();

    expect(topLevelTypes(editor)).toEqual(["paragraph", "pageBreak", "pageBreak", "paragraph"]);
  });
});
