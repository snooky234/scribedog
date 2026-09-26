import { useTranslation } from "react-i18next";

import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import { formatBinding } from "@/lib/shortcuts/binding";
import { formatFixedEditorShortcut } from "@/lib/shortcuts/fixed";
import { resolveBinding } from "@/lib/shortcuts/resolve";
import { useShortcutsStore } from "@/store/useShortcutsStore";

export type SelectionContextMenuState = { x: number; y: number };

type SelectionContextMenuProps = SelectionContextMenuState & {
  /** False while a diff review or a staged preview locks the document. */
  canAiEdit: boolean;
  /** False when the AI features are hidden in the settings: no entry at all. */
  showAiEdit: boolean;
  onAiEdit: () => void;
  onCopyFormatted: () => void;
  onCopyMarkdown: () => void;
  onCopyPlainText: () => void;
  onClose: () => void;
};

/**
 * The right-click menu on a non-empty editor selection. Its buttons swallow
 * mousedown so the editor keeps focus and its DOM selection: "copy with
 * formatting" replays the native copy on exactly that selection.
 */
export function SelectionContextMenu({
  x,
  y,
  canAiEdit,
  showAiEdit,
  onAiEdit,
  onCopyFormatted,
  onCopyMarkdown,
  onCopyPlainText,
  onClose
}: SelectionContextMenuProps) {
  const { t } = useTranslation();
  const overrides = useShortcutsStore((state) => state.overrides);

  const aiItems = [
    {
      id: "aiEdit",
      label: t("editorContextMenu.aiEdit"),
      keys: formatBinding(t, resolveBinding(overrides, "aiEditDialog")),
      disabled: !canAiEdit,
      run: onAiEdit
    }
  ];

  const items = [
    ...(showAiEdit ? aiItems : []),
    {
      id: "copyFormatted",
      label: t("editorContextMenu.copyFormatted"),
      keys: formatFixedEditorShortcut(t, "copyFormatted"),
      disabled: false,
      run: onCopyFormatted
    },
    {
      id: "copyMarkdown",
      label: t("editorContextMenu.copyMarkdown"),
      keys: formatFixedEditorShortcut(t, "copyMarkdown"),
      disabled: false,
      run: onCopyMarkdown
    },
    {
      id: "copyPlainText",
      label: t("editorContextMenu.copyPlainText"),
      keys: formatFixedEditorShortcut(t, "copyPlainText"),
      disabled: false,
      run: onCopyPlainText
    }
  ];

  return (
    <ContextMenuSurface x={x} y={y} onMouseDown={(event) => event.preventDefault()}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="file-tree-context-menu__item"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          <span className="file-tree-context-menu__label">{item.label}</span>
          <kbd className="file-tree-context-menu__keys">{item.keys}</kbd>
        </button>
      ))}
    </ContextMenuSurface>
  );
}
