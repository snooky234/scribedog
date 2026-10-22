// Round trip of reminders through Markdown and the rules that keep a reminder
// on its block while the text around it is edited. Parsing goes through
// markdown-it and a DOM, hence the jsdom environment for this file.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import {
  collectReminderBlocks,
  findReminderBlock,
  Reminders,
  setReminderTransaction
} from "@/lib/editor/extensions/reminder";
import { parseMarkdownToBlocks } from "@/lib/export/markdownModel";
import type { Reminder } from "@/lib/reminders/reminderMarker";

const editors: Editor[] = [];

function createEditor(markdown: string): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...buildPreviewExtensions(), Reminders],
    content: markdown
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? "";
}

function reminders(editor: Editor): Array<{ text: string; due: string }> {
  return collectReminderBlocks(editor.state.doc).map(({ node, reminder }) => ({
    text: node.textContent,
    due: reminder!.due
  }));
}

/** Puts the caret `offset` characters into the text block containing `text`. */
function placeCaret(editor: Editor, text: string, offset: number): void {
  let target = -1;

  editor.state.doc.descendants((node, pos) => {
    if (target === -1 && node.isTextblock && node.textContent === text) {
      target = pos + 1 + offset;
    }

    return target === -1;
  });

  expect(target).toBeGreaterThan(-1);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)));
}

const A = "<!-- reminder: 2026-10-25 09:00 -->";
const B = '<!-- reminder: 2026-11-01 18:30 "Second" -->';

describe("reminder markdown", () => {
  it.each([
    ["a paragraph", `Shorten this. ${A}\n`],
    ["a heading", `## Chapter ${A}\n`],
    ["a tight bullet list", `- one ${A}\n- two\n- three\n`],
    ["an ordered list", `1. one\n2. two ${A}\n`],
    // Checklists are written with a blank line between the items anyway.
    ["a checklist", `- [ ] open ${A}\n\n- [x] done ${B}\n`],
    ["a nested list", `- one\n  - inner ${A}\n- two\n`],
    ["a quote", `> quoted ${A}\n`],
    ["a reminder with a note", `Text ${B}\n`]
  ])("round-trips %s unchanged", (_label, markdown) => {
    const editor = createEditor(markdown);

    expect(getMarkdown(editor).trim()).toBe(markdown.trim());
    expect(reminders(editor).length).toBeGreaterThan(0);
  });

  it("does not show the marker as text", () => {
    const editor = createEditor(`- [ ] open ${A}\n`);

    expect(editor.state.doc.textContent).toBe("open");
  });

  it("leaves a marker in a code block alone", () => {
    const markdown = "```\ntext <!-- reminder: 2026-10-25 09:00 -->\n```\n";
    const editor = createEditor(markdown);

    expect(reminders(editor)).toEqual([]);
    expect(getMarkdown(editor).trim()).toBe(markdown.trim());
  });

  it("keeps a marker in the middle of a paragraph as text", () => {
    const editor = createEditor(`Before ${A} after\n`);

    expect(reminders(editor)).toEqual([]);
  });

  it("is left out of the export", () => {
    const blocks = JSON.stringify(parseMarkdownToBlocks(`Text ${A}\n\n- [ ] item ${B}\n`));

    expect(blocks).not.toContain("reminder");
    expect(blocks).toContain("Text");
  });
});

describe("reminder placement", () => {
  it("stays on the first half when a block is split in the middle", () => {
    const editor = createEditor(`Hello world ${A}\n`);
    placeCaret(editor, "Hello world", 5);
    editor.commands.keyboardShortcut("Enter");

    expect(reminders(editor)).toEqual([{ text: "Hello", due: "2026-10-25" + " 09:00" }]);
  });

  it("stays with the text on Enter at the start of a block", () => {
    const editor = createEditor(`Hello ${A}\n`);
    placeCaret(editor, "Hello", 0);
    editor.commands.keyboardShortcut("Enter");

    expect(reminders(editor)).toEqual([{ text: "Hello", due: "2026-10-25 09:00" }]);
    expect(editor.state.doc.childCount).toBe(2);
  });

  it("stays with the text on Enter at the start of a list item", () => {
    const editor = createEditor(`- one\n- two ${A}\n`);
    placeCaret(editor, "two", 0);
    editor.commands.keyboardShortcut("Enter");

    expect(reminders(editor)).toEqual([{ text: "two", due: "2026-10-25 09:00" }]);
  });

  it("does not move to the new line on Enter at the end", () => {
    const editor = createEditor(`Hello ${A}\n`);
    placeCaret(editor, "Hello", 5);
    editor.commands.keyboardShortcut("Enter");

    expect(reminders(editor)).toEqual([{ text: "Hello", due: "2026-10-25 09:00" }]);
  });

  it("moves up when the lower block is joined into one without a reminder", () => {
    const editor = createEditor(`Upper\n\nLower ${A}\n`);
    placeCaret(editor, "Lower", 0);
    editor.commands.keyboardShortcut("Backspace");

    expect(reminders(editor)).toEqual([{ text: "UpperLower", due: "2026-10-25 09:00" }]);
  });

  it("keeps the upper reminder on a join and reports the lower one", () => {
    const editor = createEditor(`Upper ${A}\n\nLower ${B}\n`);
    const dropped: Reminder[][] = [];
    editor.storage.reminders.onReminderDropped = (items) => dropped.push(items);
    placeCaret(editor, "Lower", 0);
    editor.commands.keyboardShortcut("Backspace");

    expect(reminders(editor)).toEqual([{ text: "UpperLower", due: "2026-10-25 09:00" }]);

    return Promise.resolve().then(() => {
      expect(dropped).toEqual([[{ due: "2026-11-01 18:30", note: "Second" }]]);
    });
  });

  it("keeps the reminder when the upper block takes the lower one in (Delete)", () => {
    const editor = createEditor(`Upper ${A}\n\nLower\n`);
    placeCaret(editor, "Upper", 5);
    editor.commands.keyboardShortcut("Delete");

    expect(reminders(editor)).toEqual([{ text: "UpperLower", due: "2026-10-25 09:00" }]);
  });

  it("disappears with its block", () => {
    const editor = createEditor(`Keep\n\nGone ${A}\n`);
    const second = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(editor.state.tr.delete(second, editor.state.doc.content.size));

    expect(reminders(editor)).toEqual([]);
  });

  it("stays while the text is edited", () => {
    const editor = createEditor(`Hello ${A}\n`);
    placeCaret(editor, "Hello", 5);
    editor.commands.insertContent(" there");
    editor.commands.deleteRange({ from: 1, to: 3 });

    expect(reminders(editor)).toEqual([{ text: "llo there", due: "2026-10-25 09:00" }]);
  });

  it("survives turning a paragraph into a heading and back", () => {
    const editor = createEditor(`Title ${A}\n`);
    placeCaret(editor, "Title", 2);
    editor.commands.toggleHeading({ level: 2 });

    expect(getMarkdown(editor).trim()).toBe(`## Title ${A}`);

    editor.commands.setParagraph();

    expect(getMarkdown(editor).trim()).toBe(`Title ${A}`);
  });

  it("is copied with whole blocks", () => {
    const editor = createEditor(`Source ${A}\n\nTarget\n`);
    const copy = editor.state.doc.slice(0, editor.state.doc.child(0).nodeSize);
    editor.view.dispatch(editor.state.tr.replace(editor.state.doc.content.size, editor.state.doc.content.size, copy));

    expect(reminders(editor).map(({ text }) => text)).toEqual(["Source", "Source"]);
  });

  it("is removed only by an explicit edit", () => {
    const editor = createEditor(`Hello ${A}\n`);
    const tr = setReminderTransaction(editor.state.tr, 0, null)!;
    editor.view.dispatch(tr);

    expect(reminders(editor)).toEqual([]);
    expect(getMarkdown(editor).trim()).toBe("Hello");
  });
});

describe("findReminderBlock", () => {
  it("finds the block under the caret", () => {
    const editor = createEditor("- [ ] item\n");
    placeCaret(editor, "item", 2);

    expect(findReminderBlock(editor.state)?.node.textContent).toBe("item");
  });

  it("refuses table cells and empty blocks", () => {
    const editor = createEditor("| a | b |\n| --- | --- |\n| c | d |\n");
    placeCaret(editor, "c", 0);

    expect(findReminderBlock(editor.state)).toBeNull();
  });
});
