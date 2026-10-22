import { useEffect, useState } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";

import type { ReminderDialogState } from "@/components/reminders/ReminderDialog";
import {
  collectReminderBlocks,
  findReminderBlock,
  reminderBlockAt,
  REMINDER_OPEN_EVENT,
  setReminderTransaction,
  type ReminderBlock,
  type ReminderOpenEventDetail
} from "@/lib/editor/extensions/reminder";
import type { Reminder } from "@/lib/reminders/reminderMarker";
import { useRemindersStore } from "@/store/useRemindersStore";

const DROPPED_NOTICE_MS = 10_000;

function dialogStateFor(editor: TipTapEditor, block: ReminderBlock): ReminderDialogState {
  const $pos = editor.state.doc.resolve(block.pos);
  const container = $pos.parent;

  return {
    pos: block.pos,
    blockText: block.node.textContent,
    checked: container.type.name === "taskItem" ? Boolean(container.attrs.checked) : null,
    reminder: block.reminder
  };
}

/**
 * The editor's side of reminders: the dialog for the block under the caret or
 * behind a clicked bell, the notice after a join discarded a reminder, and
 * selecting the block the sidebar's list asked for once its note is open.
 */
export function useEditorReminders(editor: TipTapEditor | null, filePath: string | null) {
  const [dialog, setDialog] = useState<ReminderDialogState | null>(null);
  const [droppedCount, setDroppedCount] = useState(0);
  const revealRequest = useRemindersStore((state) => state.revealRequest);

  // Only an editable note: a note locked for a staged change of the agent
  // stays exactly as the proposal was computed against.
  const openForBlock = (block: ReminderBlock | null) => {
    if (!editor || editor.isDestroyed || !editor.isEditable || !block) {
      return;
    }

    setDialog(dialogStateFor(editor, block));
  };

  /** The dialog for the block under the caret (toolbar button, shortcut). */
  const openReminderDialog = () => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    openForBlock(findReminderBlock(editor.state));
  };

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    const dom = editor.view.dom;
    const handleOpen = (event: Event) => {
      const { pos } = (event as CustomEvent<ReminderOpenEventDetail>).detail;
      openForBlock(reminderBlockAt(editor.state.doc, pos));
    };

    dom.addEventListener(REMINDER_OPEN_EVENT, handleOpen);
    editor.storage.reminders.onReminderDropped = (dropped) => setDroppedCount(dropped.length);

    return () => {
      dom.removeEventListener(REMINDER_OPEN_EVENT, handleOpen);

      if (!editor.isDestroyed) {
        editor.storage.reminders.onReminderDropped = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (droppedCount === 0) {
      return;
    }

    const timer = window.setTimeout(() => setDroppedCount(0), DROPPED_NOTICE_MS);

    return () => window.clearTimeout(timer);
  }, [droppedCount]);

  // A dialog or notice belongs to the note it was opened in.
  useEffect(() => {
    setDialog(null);
    setDroppedCount(0);
  }, [filePath]);

  // The sidebar's list asked for a reminder of this note: select its block
  // once the note's content is in the editor.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !revealRequest || revealRequest.filePath !== filePath) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (editor.isDestroyed) {
        return;
      }

      const blocks = collectReminderBlocks(editor.state.doc);
      const block =
        blocks.find((item, index) => index === revealRequest.ordinal && item.reminder?.due === revealRequest.due) ??
        blocks.find((item) => item.reminder?.due === revealRequest.due) ??
        blocks[revealRequest.ordinal];

      useRemindersStore.getState().requestReveal(null);

      if (!block) {
        return;
      }

      editor.chain().setTextSelection(block.pos + 1 + block.node.content.size).focus().run();

      const element = editor.view.nodeDOM(block.pos);

      if (element instanceof HTMLElement) {
        element.scrollIntoView({ block: "center" });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editor, filePath, revealRequest]);

  const apply = (reminder: Reminder | null) => {
    const state = dialog;
    setDialog(null);

    if (!editor || editor.isDestroyed || !state || !editor.isEditable) {
      return;
    }

    const tr = setReminderTransaction(editor.state.tr, state.pos, reminder);

    if (tr) {
      editor.view.dispatch(tr);
    }

    editor.commands.focus();
  };

  return {
    reminderDialog: dialog,
    openReminderDialog,
    saveReminder: (reminder: Reminder) => apply(reminder),
    removeReminder: () => apply(null),
    closeReminderDialog: () => {
      setDialog(null);
      editor?.commands.focus();
    },
    droppedReminderCount: droppedCount,
    undoReminderDrop: () => {
      setDroppedCount(0);
      editor?.chain().focus().undo().run();
    },
    dismissReminderDrop: () => setDroppedCount(0)
  };
}
