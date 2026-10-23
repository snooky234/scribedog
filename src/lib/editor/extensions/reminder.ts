import { Extension } from "@tiptap/core";
import { Heading as BaseHeading } from "@tiptap/extension-heading";
import { Paragraph as BaseParagraph } from "@tiptap/extension-paragraph";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type MarkdownIt from "markdown-it";

import i18n from "@/i18n";
import { REMINDER_DATA_ATTRIBUTE, reminderMarkdownItPlugin } from "@/lib/reminders/reminderMarkdownIt";
import { formatReminderMarker, normalizeReminder, type Reminder } from "@/lib/reminders/reminderMarker";
import { formatDueLabel, isReminderDue } from "@/lib/reminders/reminderTime";
import { editOutcome, pickReminderTarget, type ReminderEditOutcome } from "@/lib/reminders/reminderTarget";

// A reminder is an attribute of a text block (paragraph or heading; a list or
// checklist item's text is a paragraph), not an inline node. As an inline
// "bell" character it could be reached by the cursor, deleted by Backspace and
// doubled up when two paragraphs are joined; as an attribute every block has
// at most one, and the bell at its end is only drawn (a widget decoration) and
// clicked. A reminder disappears in exactly two ways: its block's text is
// deleted, or the dialog removes it (a transaction carrying REMINDER_EDIT_META).
// Everything else that would drop or misplace it on the way is corrected in
// appendTransaction below:
//
// - Enter at the very start of a block only means "an empty line above"; the
//   split leaves the attribute on the empty first half, so it moves back to
//   the text.
// - Joining two blocks keeps the upper block's attributes; the lower one's
//   reminder moves up when the upper block has none, and is reported
//   (onReminderDropped, which offers undo) when it has one of its own.
// - Changing a block's type (paragraph to heading and back) creates the node
//   anew without the attribute; it is put back.

export const REMINDER_BLOCK_TYPES = new Set(["paragraph", "heading"]);

/** Transactions with this meta set a reminder on purpose; the fix-ups leave them alone. */
export const REMINDER_EDIT_META = "scribedogReminderEdit";

/** Dispatched on the editor's DOM when a bell is clicked; detail: { pos }. */
export const REMINDER_OPEN_EVENT = "scribedog-reminder-open";

export type ReminderOpenEventDetail = { pos: number };

/** Meta of the transaction the minute timer dispatches when a reminder became due. */
const REMINDER_TICK_META = "scribedogReminderTick";

type ReminderPluginState = { now: number; decorations: DecorationSet };

const reminderPluginKey = new PluginKey<ReminderPluginState>("reminders");

const TICK_INTERVAL_MS = 30_000;

function parseReminderAttribute(value: string | null): Reminder | null {
  if (!value) {
    return null;
  }

  try {
    return normalizeReminder(JSON.parse(value));
  } catch {
    return null;
  }
}

const reminderAttributes = {
  reminder: {
    default: null,
    // A split leaves the reminder on the first half only (see Enter at the
    // start of a block for the one exception).
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => parseReminderAttribute(element.getAttribute(REMINDER_DATA_ATTRIBUTE)),
    renderHTML: (attributes: { reminder?: Reminder | null }) =>
      attributes.reminder ? { [REMINDER_DATA_ATTRIBUTE]: JSON.stringify(attributes.reminder) } : {}
  }
};

type MarkdownSerializerState = {
  write: (content: string) => void;
  renderInline: (node: ProseMirrorNode, fromBlockStart?: boolean) => void;
  closeBlock: (node: ProseMirrorNode) => void;
  repeat: (text: string, count: number) => string;
  inTable?: boolean;
};

function writeReminderMarker(state: MarkdownSerializerState, node: ProseMirrorNode): void {
  const reminder = normalizeReminder(node.attrs.reminder);

  // A table row is one line per cell; a comment there would come back as
  // visible text. The dialog never sets a reminder in a cell.
  if (!reminder || state.inTable) {
    return;
  }

  state.write(`${node.content.size > 0 ? " " : ""}${formatReminderMarker(reminder)}`);
}

// tiptap-markdown runs every extension's parse setup again for each document
// it reads; markdown-it would collect one more copy of the rule every time.
const preparedParsers = new WeakSet<MarkdownIt>();

function setupReminderParser(markdownit: MarkdownIt): void {
  if (preparedParsers.has(markdownit)) {
    return;
  }

  preparedParsers.add(markdownit);
  markdownit.use(reminderMarkdownItPlugin);
}

export const Paragraph = BaseParagraph.extend({
  addAttributes() {
    return { ...this.parent?.(), ...reminderAttributes };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          state.renderInline(node);
          writeReminderMarker(state, node);
          state.closeBlock(node);
        },
        parse: {
          setup: setupReminderParser
        }
      }
    };
  }
});

export const Heading = BaseHeading.extend({
  addAttributes() {
    return { ...this.parent?.(), ...reminderAttributes };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          state.write(`${state.repeat("#", Number(node.attrs.level) || 1)} `);
          state.renderInline(node, false);
          writeReminderMarker(state, node);
          state.closeBlock(node);
        },
        parse: {
          setup: setupReminderParser
        }
      }
    };
  }
});

export type ReminderBlock = {
  /** Position before the block. */
  pos: number;
  node: ProseMirrorNode;
  reminder: Reminder | null;
};

const NO_REMINDER_ANCESTORS = new Set(["tableCell", "tableHeader", "codeBlock"]);

/**
 * The block a reminder for the current selection belongs to: the text block
 * the selection starts in. Null where a reminder cannot go (a table cell, a
 * code block, a node selection, an empty block).
 */
export function findReminderBlock(state: EditorState): ReminderBlock | null {
  const { $from } = state.selection;
  const parent = $from.parent;

  if (!parent.isTextblock || !REMINDER_BLOCK_TYPES.has(parent.type.name) || $from.depth === 0) {
    return null;
  }

  for (let depth = $from.depth - 1; depth > 0; depth--) {
    if (NO_REMINDER_ANCESTORS.has($from.node(depth).type.name)) {
      return null;
    }
  }

  if (parent.content.size === 0 && !parent.attrs.reminder) {
    return null;
  }

  return { pos: $from.before(), node: parent, reminder: normalizeReminder(parent.attrs.reminder) };
}

/** The block at `pos` when it can carry a reminder. */
export function reminderBlockAt(doc: ProseMirrorNode, pos: number): ReminderBlock | null {
  const node = doc.nodeAt(pos);

  if (!node || !REMINDER_BLOCK_TYPES.has(node.type.name)) {
    return null;
  }

  return { pos, node, reminder: normalizeReminder(node.attrs.reminder) };
}

/** Every block with a reminder, in document order. */
export function collectReminderBlocks(doc: ProseMirrorNode): ReminderBlock[] {
  const blocks: ReminderBlock[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }

    const reminder = REMINDER_BLOCK_TYPES.has(node.type.name) ? normalizeReminder(node.attrs.reminder) : null;

    if (reminder) {
      blocks.push({ pos, node, reminder });
    }

    return false;
  });

  return blocks;
}

/** Sets (or, with null, removes) the reminder of the block at `pos`. */
export function setReminderTransaction(tr: Transaction, pos: number, reminder: Reminder | null): Transaction | null {
  const node = tr.doc.nodeAt(pos);

  if (!node || !REMINDER_BLOCK_TYPES.has(node.type.name)) {
    return null;
  }

  return tr.setNodeMarkup(pos, undefined, { ...node.attrs, reminder }).setMeta(REMINDER_EDIT_META, true);
}

/**
 * The chat agent's way of setting (or, with null, removing) a reminder: the
 * block is found by its text instead of by the selection, and only its
 * attribute changes, so the text cannot drift along the way. `tr` is null
 * when there is nothing to dispatch.
 */
export function agentReminderTransaction(
  state: EditorState,
  needle: string,
  reminder: Reminder | null
): { outcome: ReminderEditOutcome; tr: Transaction | null } {
  const candidates: { pos: number; node: ProseMirrorNode }[] = [];

  state.doc.descendants((node, pos) => {
    if (NO_REMINDER_ANCESTORS.has(node.type.name)) {
      return false;
    }

    if (!node.isTextblock) {
      return true;
    }

    if (REMINDER_BLOCK_TYPES.has(node.type.name) && node.content.size > 0) {
      candidates.push({ pos, node });
    }

    return false;
  });

  const match = pickReminderTarget(
    candidates.map(({ node }) => node.textContent),
    needle
  );

  if (match.kind !== "found") {
    return { outcome: match, tr: null };
  }

  const { pos, node } = candidates[match.index];
  const outcome = editOutcome(node.textContent, normalizeReminder(node.attrs.reminder), reminder);

  if (outcome.kind !== "set" && outcome.kind !== "removed") {
    return { outcome, tr: null };
  }

  return { outcome, tr: setReminderTransaction(state.tr, pos, reminder) };
}

function sameReminder(a: Reminder | null, b: Reminder | null): boolean {
  return a?.due === b?.due && (a?.note ?? null) === (b?.note ?? null);
}

function nextTextblock(doc: ProseMirrorNode, from: number): { node: ProseMirrorNode; pos: number } | null {
  let found: { node: ProseMirrorNode; pos: number } | null = null;

  doc.nodesBetween(from, doc.content.size, (node, pos) => {
    if (found) {
      return false;
    }

    if (node.isTextblock) {
      if (pos >= from) {
        found = { node, pos };
      }

      return false;
    }

    return true;
  });

  return found;
}

function canTakeReminder(node: ProseMirrorNode): boolean {
  return REMINDER_BLOCK_TYPES.has(node.type.name) && !node.attrs.reminder;
}

/**
 * The fix-ups described at the top of the file, as one transaction (or null
 * when nothing needs fixing). `dropped` collects the reminders a join had to
 * discard because the block they were joined into had one already.
 */
export function fixReminderPlacement(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
  dropped: Reminder[]
): Transaction | null {
  if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => tr.getMeta(REMINDER_EDIT_META))) {
    return null;
  }

  const before = collectReminderBlocks(oldState.doc);

  if (before.length === 0) {
    return null;
  }

  const mapping = new Mapping();
  transactions.forEach((tr) => mapping.appendMapping(tr.mapping));

  const tr = newState.tr;

  const setReminder = (pos: number, node: ProseMirrorNode, reminder: Reminder | null) => {
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, reminder });
  };

  for (const { pos, node, reminder } of before) {
    if (!reminder) {
      continue;
    }

    const start = mapping.mapResult(pos, 1);

    if (!start.deleted) {
      const current = tr.doc.nodeAt(start.pos);

      if (!current?.isTextblock) {
        continue;
      }

      const currentReminder = normalizeReminder(current.attrs.reminder);
      const next = nextTextblock(tr.doc, start.pos + current.nodeSize);
      const nextReminder = next ? normalizeReminder(next.node.attrs.reminder) : null;
      // The block was split (Enter): its text is now spread over this block
      // and the next one. ProseMirror copies the attributes to both halves
      // unless the split is at the very end.
      const split =
        next !== null &&
        node.content.size > 0 &&
        REMINDER_BLOCK_TYPES.has(next.node.type.name) &&
        current.textContent + next.node.textContent === node.textContent;

      if (split && sameReminder(currentReminder, reminder)) {
        if (current.content.size === 0) {
          // Enter at the start: only an empty line above, the reminder stays
          // with the text.
          setReminder(start.pos, current, null);

          if (!nextReminder) {
            setReminder(next.pos, next.node, reminder);
          }
        } else if (sameReminder(nextReminder, reminder)) {
          setReminder(next.pos, next.node, null);
        }

        continue;
      }

      if (sameReminder(currentReminder, reminder)) {
        continue;
      }

      // The block was recreated with another type and lost the attribute.
      if (!currentReminder && canTakeReminder(current) && current.textContent === node.textContent) {
        setReminder(start.pos, current, reminder);
      }

      continue;
    }

    // The block's start is gone. If the end of its text survived, the block
    // was joined into the one above; otherwise its text was deleted, and the
    // reminder with it.
    const end = mapping.mapResult(pos + 1 + node.content.size, -1);

    if (end.deleted || node.content.size === 0) {
      continue;
    }

    const $end = tr.doc.resolve(end.pos);
    const target = $end.parent;

    if (!target.isTextblock || !REMINDER_BLOCK_TYPES.has(target.type.name) || $end.depth === 0) {
      continue;
    }

    const targetReminder = normalizeReminder(target.attrs.reminder);

    if (!targetReminder) {
      setReminder($end.before(), target, reminder);
    } else if (!sameReminder(targetReminder, reminder)) {
      dropped.push(reminder);
    }
  }

  return tr.docChanged ? tr : null;
}

const BELL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>';

function createBell(view: EditorView, getPos: () => number | undefined, reminder: Reminder, due: boolean): HTMLElement {
  const bell = document.createElement("button");
  bell.type = "button";
  bell.className = due ? "reminder-bell reminder-bell--due" : "reminder-bell";
  bell.contentEditable = "false";
  bell.tabIndex = -1;
  bell.innerHTML = BELL_SVG;

  const label = i18n.t(due ? "reminders.bellDue" : "reminders.bell", { due: formatDueLabel(reminder.due) });
  bell.title = reminder.note ? `${label}\n${reminder.note}` : label;
  bell.setAttribute("aria-label", label);

  // Keep the caret where it is; the click alone opens the dialog.
  bell.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  bell.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const widgetPos = getPos();

    if (widgetPos === undefined) {
      return;
    }

    // The widget sits at the end of its block's content.
    const $widget = view.state.doc.resolve(widgetPos);
    const detail: ReminderOpenEventDetail = { pos: $widget.before() };
    view.dom.dispatchEvent(new CustomEvent(REMINDER_OPEN_EVENT, { detail, bubbles: true }));
  });

  return bell;
}

function buildDecorations(doc: ProseMirrorNode, now: number): DecorationSet {
  const decorations = collectReminderBlocks(doc).map(({ pos, node, reminder }) => {
    const due = isReminderDue(reminder!, now);

    return Decoration.widget(
      pos + 1 + node.content.size,
      (view, getPos) => createBell(view, getPos, reminder!, due),
      {
        side: 1,
        ignoreSelection: true,
        key: `reminder:${reminder!.due}:${due ? 1 : 0}:${reminder!.note ?? ""}:${i18n.language}`
      }
    );
  });

  return DecorationSet.create(doc, decorations);
}

function countDue(doc: ProseMirrorNode, now: number): number {
  return collectReminderBlocks(doc).filter(({ reminder }) => isReminderDue(reminder!, now)).length;
}

export type RemindersStorage = {
  /** Called after a join discarded reminders (see fixReminderPlacement); the editor offers undo. */
  onReminderDropped: ((dropped: Reminder[]) => void) | null;
};

declare module "@tiptap/core" {
  interface Storage {
    reminders: RemindersStorage;
  }
}

export const Reminders = Extension.create<Record<string, never>, RemindersStorage>({
  name: "reminders",

  addStorage() {
    return { onReminderDropped: null };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;

    return [
      new Plugin<ReminderPluginState>({
        key: reminderPluginKey,
        state: {
          // `now` is the time the bells were drawn for; the timer below moves
          // it on when a reminder has become due since.
          init: (_config, state) => {
            const now = Date.now();

            return { now, decorations: buildDecorations(state.doc, now) };
          },
          apply: (tr, value, _oldState, newState) => {
            const tick = tr.getMeta(REMINDER_TICK_META) as number | undefined;

            if (tick === undefined && !tr.docChanged) {
              return value;
            }

            const now = tick ?? value.now;

            return { now, decorations: buildDecorations(newState.doc, now) };
          }
        },
        props: {
          decorations(state) {
            return reminderPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          }
        },
        appendTransaction(transactions, oldState, newState) {
          const dropped: Reminder[] = [];
          const fix = fixReminderPlacement(transactions, oldState, newState, dropped);

          if (dropped.length > 0) {
            const callback = storage.onReminderDropped;
            queueMicrotask(() => callback?.(dropped));
          }

          return fix;
        },
        view(view) {
          const timer = window.setInterval(() => {
            const now = Date.now();
            const drawnFor = reminderPluginKey.getState(view.state)?.now ?? now;

            if (countDue(view.state.doc, now) !== countDue(view.state.doc, drawnFor)) {
              view.dispatch(view.state.tr.setMeta(REMINDER_TICK_META, now).setMeta("addToHistory", false));
            }
          }, TICK_INTERVAL_MS);

          return {
            destroy: () => window.clearInterval(timer)
          };
        }
      })
    ];
  }
});
