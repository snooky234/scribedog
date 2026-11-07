import type { TFunction } from "i18next";

import { bindingsConflict, formatBinding, matchesBinding, type ShortcutBinding } from "@/lib/shortcuts/binding";

export type FixedEditorShortcutId =
  | "copyFormatted"
  | "copyMarkdown"
  | "copyPlainText"
  | "pastePlainText"
  | "pasteMarkdown";

export type FixedEditorShortcut = {
  id: FixedEditorShortcutId;
  binding: ShortcutBinding;
  /** Label of the selection context menu entry that carries the combo. */
  labelKey: string;
};

function ctrlCombo(letter: "C" | "V", modifiers: { alt?: boolean; shift?: boolean }): ShortcutBinding {
  return {
    ctrl: true,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false,
    code: `Key${letter}`,
    key: letter.toLowerCase(),
    label: letter
  };
}

/**
 * The three ways of copying a selection out of the editor and the two
 * explicit ways of pasting: without Markdown conversion, and with it forced.
 * Unlike everything in `definitions.ts` they are deliberately *not*
 * remappable: Ctrl+C and Ctrl+V belong to the platform, and the variants next
 * to them stay where a user expects them relative to those (Ctrl+Shift+V is
 * "paste as plain text" in every browser, Ctrl+Alt+V mirrors Ctrl+Alt+C).
 * They are checked before the registry in the editor's keydown handler and
 * refused by the shortcuts dialog's recorder.
 */
export const FIXED_EDITOR_SHORTCUTS: FixedEditorShortcut[] = [
  { id: "copyFormatted", binding: ctrlCombo("C", {}), labelKey: "editorContextMenu.copyFormatted" },
  { id: "copyMarkdown", binding: ctrlCombo("C", { alt: true }), labelKey: "editorContextMenu.copyMarkdown" },
  { id: "copyPlainText", binding: ctrlCombo("C", { shift: true }), labelKey: "editorContextMenu.copyPlainText" },
  { id: "pastePlainText", binding: ctrlCombo("V", { shift: true }), labelKey: "editorContextMenu.pastePlainText" },
  { id: "pasteMarkdown", binding: ctrlCombo("V", { alt: true }), labelKey: "editorContextMenu.pasteMarkdown" }
];

const FIXED_EDITOR_SHORTCUTS_BY_ID = new Map(FIXED_EDITOR_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

export function matchFixedEditorShortcut(event: KeyboardEvent): FixedEditorShortcutId | null {
  const match = FIXED_EDITOR_SHORTCUTS.find((shortcut) => matchesBinding(event, shortcut.binding));

  return match?.id ?? null;
}

/** The fixed shortcut a binding would clash with, or null. */
export function findFixedConflict(binding: ShortcutBinding): FixedEditorShortcut | null {
  return FIXED_EDITOR_SHORTCUTS.find((shortcut) => bindingsConflict(shortcut.binding, binding)) ?? null;
}

export function formatFixedEditorShortcut(t: TFunction, id: FixedEditorShortcutId): string {
  return formatBinding(t, FIXED_EDITOR_SHORTCUTS_BY_ID.get(id)!.binding);
}
