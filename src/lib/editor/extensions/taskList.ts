import { Extension } from "@tiptap/core";
import BaseTaskList from "@tiptap/extension-task-list";
import type MarkdownIt from "markdown-it";

// markdown-it/@types/markdown-it don't export the Token type from the package
// root, so it's derived from a signature that uses it.
type MarkdownItToken = Parameters<MarkdownIt["renderer"]["renderToken"]>[0][number];

// markdown-it-task-lists also converts numbered checklist syntax ("1. [ ] ...")
// into <ol data-type="taskList">, but the base extension only recognizes
// <ul data-type="taskList"> when parsing. Without this extension the "[ ]"
// brackets render as plain text instead of a clickable checkbox.
export const TaskList = BaseTaskList.extend({
  parseHTML() {
    return [
      { tag: 'ul[data-type="taskList"]', priority: 51 },
      { tag: 'ol[data-type="taskList"]', priority: 51 }
    ];
  }
});

const EMPTY_CHECKBOX_PATTERN = /^\[([ xX])\]$/;

function findListTokenIndex(tokens: MarkdownItToken[], itemIndex: number): number {
  const listLevel = tokens[itemIndex].level - 1;

  for (let i = itemIndex - 1; i >= 0; i--) {
    if (tokens[i].level === listLevel) {
      return i;
    }
  }

  return -1;
}

// markdown-it-task-lists (used by tiptap-markdown) only recognizes a checkbox
// when text follows it — "[ ] " with a trailing space. An *empty* task item
// ("- [ ]", exactly what this editor writes for a checkbox with no text yet)
// therefore parsed as an ordinary list item whose text is literally "[ ]", and
// the serializer wrote that text back escaped as "- \[ \]". Opening such a file
// silently rewrote it, which showed up as unsaved changes right after opening.
// This rule marks up the empty case exactly like the plugin marks up the
// non-empty one. Escaped brackets ("- \[ \]") keep their backslashes in
// token.content and stay plain text, same as in markdown-it-task-lists.
export function emptyTaskItemMarkdownItPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "scribedog_empty_task_item", (state) => {
    const tokens = state.tokens;

    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];

      if (
        inline.type !== "inline" ||
        tokens[i - 1].type !== "paragraph_open" ||
        tokens[i - 2].type !== "list_item_open"
      ) {
        continue;
      }

      const match = EMPTY_CHECKBOX_PATTERN.exec(inline.content);

      if (!match) {
        continue;
      }

      const checkbox = new state.Token("html_inline", "", 0);
      checkbox.content = `<input class="task-list-item-checkbox"${
        match[1] === " " ? "" : ' checked=""'
      } disabled="" type="checkbox">`;

      inline.children = [checkbox];
      inline.content = "";

      tokens[i - 2].attrJoin("class", "task-list-item");

      const listIndex = findListTokenIndex(tokens, i - 2);

      if (listIndex >= 0) {
        tokens[listIndex].attrJoin("class", "contains-task-list");
      }
    }
  });
}

// markdown-it puts consecutive "-" items into a single list even when only some
// of them are checkboxes, and tiptap-markdown then flags that whole list as
// data-type="taskList". ProseMirror can't fit the plain items into a taskList
// (it only takes taskItem children), so it repairs the mismatch by inserting an
// empty task item and moving the rest into a separate bullet list — a checkbox
// out of thin air on every load. Splitting the list into homogeneous runs up
// front gives ProseMirror exactly the structure the serializer writes back.
function splitMixedTaskLists(element: HTMLElement): void {
  // Innermost first: a nested list has to be rebuilt before its parent list
  // moves the list item it lives in.
  const lists = [...element.querySelectorAll("ul.contains-task-list, ol.contains-task-list")].reverse();

  for (const list of lists) {
    const items = [...list.children].filter((child) => child.tagName === "LI");

    if (items.length !== list.children.length) {
      continue;
    }

    const segments: { isTask: boolean; items: Element[] }[] = [];

    for (const item of items) {
      const isTask = item.classList.contains("task-list-item");
      const currentSegment = segments[segments.length - 1];

      if (currentSegment && currentSegment.isTask === isTask) {
        currentSegment.items.push(item);
      } else {
        segments.push({ isTask, items: [item] });
      }
    }

    if (segments.length < 2) {
      continue;
    }

    for (const segment of segments) {
      const listCopy = list.ownerDocument.createElement(list.tagName);

      for (const attribute of Array.from(list.attributes)) {
        listCopy.setAttribute(attribute.name, attribute.value);
      }

      if (segment.isTask) {
        listCopy.classList.add("contains-task-list");
      } else {
        listCopy.classList.remove("contains-task-list");
        listCopy.removeAttribute("data-type");

        if (listCopy.getAttribute("class") === "") {
          listCopy.removeAttribute("class");
        }
      }

      listCopy.append(...segment.items);
      list.parentNode?.insertBefore(listCopy, list);
    }

    list.remove();
  }
}

// Both fixes hook into tiptap-markdown's parse pipeline. They live in their own
// extension rather than on TaskList/TaskItem because those two get their
// markdown spec (serializer, markdown-it-task-lists setup) from tiptap-markdown,
// and overriding addStorage() there would replace it wholesale.
export const TaskListMarkdown = Extension.create({
  name: "taskListMarkdown",

  addStorage() {
    return {
      markdown: {
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(emptyTaskItemMarkdownItPlugin);
          },
          updateDOM(element: HTMLElement) {
            splitMixedTaskLists(element);
          }
        }
      }
    };
  }
});
