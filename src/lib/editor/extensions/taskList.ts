import BaseTaskList from "@tiptap/extension-task-list";

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
