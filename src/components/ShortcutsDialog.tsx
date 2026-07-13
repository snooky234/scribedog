import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

type ShortcutsDialogProps = {
  open: boolean;
  onClose: () => void;
};

type KeyToken = { mod: "ctrl" | "alt" | "shift" } | { special: "esc" | "enter" | "rightClick" } | { literal: string };

type ShortcutDefinition = {
  id: string;
  keys: KeyToken[][];
  descriptionKey: string;
};

const SHORTCUTS: ShortcutDefinition[] = [
  { id: "openFolder", keys: [[{ mod: "ctrl" }, { literal: "O" }]], descriptionKey: "shortcutsDialog.items.openFolder" },
  { id: "newFile", keys: [[{ mod: "ctrl" }, { literal: "N" }]], descriptionKey: "shortcutsDialog.items.newFile" },
  { id: "saveFile", keys: [[{ mod: "ctrl" }, { literal: "S" }]], descriptionKey: "shortcutsDialog.items.saveFile" },
  {
    id: "aiEditDialog",
    keys: [[{ mod: "ctrl" }, { literal: "E" }], [{ special: "rightClick" }]],
    descriptionKey: "shortcutsDialog.items.aiEditDialog"
  },
  {
    id: "aiSubmit",
    keys: [[{ mod: "ctrl" }, { special: "enter" }]],
    descriptionKey: "shortcutsDialog.items.aiSubmit"
  },
  {
    id: "aiCheckDialog",
    keys: [[{ mod: "ctrl" }, { mod: "shift" }, { literal: "X" }]],
    descriptionKey: "shortcutsDialog.items.aiCheckDialog"
  },
  { id: "bold", keys: [[{ mod: "ctrl" }, { literal: "B" }]], descriptionKey: "shortcutsDialog.items.bold" },
  { id: "italic", keys: [[{ mod: "ctrl" }, { literal: "I" }]], descriptionKey: "shortcutsDialog.items.italic" },
  { id: "underline", keys: [[{ mod: "ctrl" }, { literal: "U" }]], descriptionKey: "shortcutsDialog.items.underline" },
  { id: "insertLink", keys: [[{ mod: "ctrl" }, { literal: "M" }]], descriptionKey: "shortcutsDialog.items.insertLink" },
  { id: "bulletList", keys: [[{ mod: "ctrl" }, { literal: "." }]], descriptionKey: "shortcutsDialog.items.bulletList" },
  {
    id: "orderedList",
    keys: [[{ mod: "ctrl" }, { literal: "-" }]],
    descriptionKey: "shortcutsDialog.items.orderedList"
  },
  { id: "checkbox", keys: [[{ mod: "ctrl" }, { literal: "," }]], descriptionKey: "shortcutsDialog.items.checkbox" },
  { id: "strikethrough", keys: [[{ mod: "ctrl" }, { literal: "D" }]], descriptionKey: "shortcutsDialog.items.strikethrough" },
  { id: "heading1", keys: [[{ mod: "ctrl" }, { literal: "1" }]], descriptionKey: "shortcutsDialog.items.heading1" },
  { id: "heading2", keys: [[{ mod: "ctrl" }, { literal: "2" }]], descriptionKey: "shortcutsDialog.items.heading2" },
  { id: "heading3", keys: [[{ mod: "ctrl" }, { literal: "3" }]], descriptionKey: "shortcutsDialog.items.heading3" },
  { id: "blockquote", keys: [[{ mod: "ctrl" }, { literal: "Q" }]], descriptionKey: "shortcutsDialog.items.blockquote" },
  { id: "inlineCode", keys: [[{ mod: "ctrl" }, { literal: "G" }]], descriptionKey: "shortcutsDialog.items.inlineCode" },
  { id: "codeBlock", keys: [[{ mod: "ctrl" }, { literal: "K" }]], descriptionKey: "shortcutsDialog.items.codeBlock" },
  {
    id: "moveListItem",
    keys: [
      [{ mod: "alt" }, { mod: "shift" }, { literal: "↑" }],
      [{ mod: "alt" }, { mod: "shift" }, { literal: "↓" }]
    ],
    descriptionKey: "shortcutsDialog.items.moveListItem"
  },
  { id: "copy", keys: [[{ mod: "ctrl" }, { literal: "C" }]], descriptionKey: "shortcutsDialog.items.copy" },
  { id: "paste", keys: [[{ mod: "ctrl" }, { literal: "V" }]], descriptionKey: "shortcutsDialog.items.paste" },
  { id: "undo", keys: [[{ mod: "ctrl" }, { literal: "Z" }]], descriptionKey: "shortcutsDialog.items.undo" },
  { id: "redo", keys: [[{ mod: "ctrl" }, { literal: "Y" }]], descriptionKey: "shortcutsDialog.items.redo" },
  {
    id: "shortcutsOverview",
    keys: [[{ mod: "ctrl" }, { literal: "#" }]],
    descriptionKey: "shortcutsDialog.items.shortcutsOverview"
  },
  { id: "closeDialog", keys: [[{ special: "esc" }]], descriptionKey: "shortcutsDialog.items.closeDialog" }
];

function formatKeyCombo(t: TFunction, tokens: KeyToken[]): string {
  return tokens
    .map((token) => {
      if ("mod" in token) {
        return t(`common.keys.${token.mod}`);
      }

      if ("special" in token) {
        return t(`common.keys.${token.special}`);
      }

      return token.literal;
    })
    .join(" + ");
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="ai-dialog" role="presentation" onClick={onClose}>
      <div
        className="ai-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="shortcuts-title">{t("shortcutsDialog.title")}</h3>
        <p className="ai-dialog__description">{t("shortcutsDialog.description")}</p>

        <ul className="shortcuts-list">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.id} className="shortcuts-list__item">
              <span className="shortcuts-list__keys-group">
                {shortcut.keys.map((tokens, index) => (
                  <kbd key={index} className="shortcuts-list__keys">
                    {formatKeyCombo(t, tokens)}
                  </kbd>
                ))}
              </span>
              <span>{t(shortcut.descriptionKey)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
