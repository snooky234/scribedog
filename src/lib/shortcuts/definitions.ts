import type { ShortcutBinding } from "@/lib/shortcuts/binding";

/**
 * Where a shortcut is evaluated. "global" handlers listen on the window and
 * fire regardless of focus; "editor" handlers run inside ProseMirror's
 * keydown handling and only fire while the editor has focus.
 */
export type ShortcutScope = "global" | "editor";

/** Grouping in the shortcuts dialog only. */
export type ShortcutCategory = "app" | "ai" | "format";

export type ShortcutActionId =
  | "openFolder"
  | "newFile"
  | "saveFile"
  | "printFile"
  | "findReplace"
  | "zenMode"
  | "toggleSpellcheck"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "shortcutsOverview"
  | "navigateBack"
  | "navigateForward"
  | "toggleChat"
  | "toggleLinksPanel"
  | "aiEditDialog"
  | "aiVoiceDialog"
  | "dictation"
  | "aiCheckDialog"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "insertLink"
  | "bulletList"
  | "orderedList"
  | "checkbox"
  | "checkboxToggle"
  | "blockquote"
  | "inlineCode"
  | "codeBlock"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "moveListItemUp"
  | "moveListItemDown";

export type ShortcutDefinition = {
  id: ShortcutActionId;
  scope: ShortcutScope;
  category: ShortcutCategory;
  descriptionKey: string;
  defaultBinding: ShortcutBinding;
  /**
   * Extra combos accepted *only* while the action still uses its default —
   * they exist so the stock bindings keep working across keyboard layouts
   * (e.g. Ctrl+Shift+= for zoom in on US layouts). Once the user assigns
   * their own combo, only that combo counts.
   */
  defaultAlternates?: ShortcutBinding[];
};

type Modifiers = { ctrl?: boolean; alt?: boolean; shift?: boolean };

function combo(modifiers: Modifiers, code: string, key: string, label: string): ShortcutBinding {
  return {
    ctrl: modifiers.ctrl === true,
    alt: modifiers.alt === true,
    shift: modifiers.shift === true,
    code,
    key,
    label
  };
}

function letter(modifiers: Modifiers, character: string): ShortcutBinding {
  return combo(modifiers, `Key${character.toUpperCase()}`, character.toLowerCase(), character.toUpperCase());
}

function digit(modifiers: Modifiers, character: string): ShortcutBinding {
  return combo(modifiers, `Digit${character}`, character, character);
}

const CTRL: Modifiers = { ctrl: true };
const CTRL_SHIFT: Modifiers = { ctrl: true, shift: true };

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: "openFolder",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.openFolder",
    defaultBinding: letter(CTRL, "O")
  },
  {
    id: "newFile",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.newFile",
    defaultBinding: letter(CTRL, "N")
  },
  {
    id: "saveFile",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.saveFile",
    defaultBinding: letter(CTRL, "S")
  },
  {
    id: "printFile",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.printFile",
    defaultBinding: letter(CTRL, "P")
  },
  {
    id: "findReplace",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.findReplace",
    defaultBinding: letter(CTRL, "F")
  },
  {
    id: "zenMode",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.zenMode",
    defaultBinding: letter(CTRL_SHIFT, "Y")
  },
  {
    id: "toggleSpellcheck",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.toggleSpellcheck",
    defaultBinding: letter({ ctrl: true, alt: true, shift: true }, "X")
  },
  {
    id: "zoomIn",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.zoomIn",
    defaultBinding: combo(CTRL, "Equal", "+", "+"),
    // US layouts put "+" behind Shift on the same physical key.
    defaultAlternates: [combo(CTRL_SHIFT, "Equal", "+", "+")]
  },
  {
    id: "zoomOut",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.zoomOut",
    defaultBinding: combo(CTRL, "Minus", "-", "-")
  },
  {
    id: "zoomReset",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.zoomReset",
    defaultBinding: digit(CTRL, "0")
  },
  {
    id: "shortcutsOverview",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.shortcutsOverview",
    // German layouts have "#" on the physical Backslash key.
    defaultBinding: combo(CTRL, "Backslash", "#", "#"),
    defaultAlternates: [combo(CTRL_SHIFT, "Backslash", "#", "#")]
  },
  {
    id: "navigateBack",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.navigateBack",
    defaultBinding: combo({ alt: true }, "ArrowLeft", "", "←")
  },
  {
    id: "navigateForward",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.navigateForward",
    defaultBinding: combo({ alt: true }, "ArrowRight", "", "→")
  },
  {
    id: "toggleChat",
    scope: "global",
    category: "ai",
    descriptionKey: "shortcutsDialog.items.toggleChat",
    defaultBinding: letter(CTRL_SHIFT, "A")
  },
  {
    id: "toggleLinksPanel",
    scope: "global",
    category: "app",
    descriptionKey: "shortcutsDialog.items.toggleLinksPanel",
    defaultBinding: letter(CTRL_SHIFT, "L")
  },
  {
    id: "aiEditDialog",
    scope: "editor",
    category: "ai",
    descriptionKey: "shortcutsDialog.items.aiEditDialog",
    defaultBinding: letter(CTRL, "E")
  },
  {
    id: "aiVoiceDialog",
    scope: "editor",
    category: "ai",
    descriptionKey: "shortcutsDialog.items.aiVoiceDialog",
    defaultBinding: letter(CTRL_SHIFT, "E")
  },
  {
    id: "dictation",
    scope: "editor",
    category: "ai",
    descriptionKey: "shortcutsDialog.items.dictation",
    defaultBinding: letter(CTRL_SHIFT, "W")
  },
  {
    id: "aiCheckDialog",
    scope: "editor",
    category: "ai",
    descriptionKey: "shortcutsDialog.items.aiCheckDialog",
    defaultBinding: letter(CTRL_SHIFT, "X")
  },
  {
    id: "bold",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.bold",
    defaultBinding: letter(CTRL, "B")
  },
  {
    id: "italic",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.italic",
    defaultBinding: letter(CTRL, "I")
  },
  {
    id: "underline",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.underline",
    defaultBinding: letter(CTRL, "U")
  },
  {
    id: "strikethrough",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.strikethrough",
    defaultBinding: letter(CTRL, "D")
  },
  {
    id: "insertLink",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.insertLink",
    defaultBinding: letter(CTRL, "L")
  },
  {
    id: "bulletList",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.bulletList",
    defaultBinding: combo(CTRL, "Period", ".", ".")
  },
  {
    id: "orderedList",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.orderedList",
    defaultBinding: letter(CTRL_SHIFT, "O")
  },
  {
    id: "checkbox",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.checkbox",
    defaultBinding: combo(CTRL, "Comma", ",", ",")
  },
  {
    id: "checkboxToggle",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.checkboxToggle",
    // Shift turns "," into "<" on many layouts, so only the code can match.
    defaultBinding: combo(CTRL_SHIFT, "Comma", "", ",")
  },
  {
    id: "blockquote",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.blockquote",
    defaultBinding: letter(CTRL, "Q")
  },
  {
    id: "inlineCode",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.inlineCode",
    defaultBinding: letter(CTRL, "G")
  },
  {
    id: "codeBlock",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.codeBlock",
    defaultBinding: letter(CTRL, "K")
  },
  {
    id: "heading1",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.heading1",
    defaultBinding: digit(CTRL, "1")
  },
  {
    id: "heading2",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.heading2",
    defaultBinding: digit(CTRL, "2")
  },
  {
    id: "heading3",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.heading3",
    defaultBinding: digit(CTRL, "3")
  },
  {
    id: "heading4",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.heading4",
    defaultBinding: digit(CTRL, "4")
  },
  {
    id: "heading5",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.heading5",
    defaultBinding: digit(CTRL, "5")
  },
  {
    id: "heading6",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.heading6",
    defaultBinding: digit(CTRL, "6")
  },
  {
    id: "moveListItemUp",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.moveListItemUp",
    defaultBinding: combo({ alt: true, shift: true }, "ArrowUp", "", "↑")
  },
  {
    id: "moveListItemDown",
    scope: "editor",
    category: "format",
    descriptionKey: "shortcutsDialog.items.moveListItemDown",
    defaultBinding: combo({ alt: true, shift: true }, "ArrowDown", "", "↓")
  }
];

export const SHORTCUT_DEFINITIONS_BY_ID = new Map<ShortcutActionId, ShortcutDefinition>(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition])
);

export const SHORTCUT_CATEGORY_ORDER: ShortcutCategory[] = ["app", "ai", "format"];

export function isShortcutActionId(value: string): value is ShortcutActionId {
  return SHORTCUT_DEFINITIONS_BY_ID.has(value as ShortcutActionId);
}
