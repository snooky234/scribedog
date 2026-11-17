import { Columns2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useLayoutMode } from "@/hooks/useLayoutMode";
import { samePath } from "@/lib/compareTarget";
import { useAppStore } from "@/store/useAppStore";
import { useCompareStore } from "@/store/useCompareStore";

/**
 * "Open as reference" in the context menus of the tree and the "In progress"
 * list. Desktop only: phone and tablet have no width for a second note.
 * Disabled with nothing open, or on the open note itself, since the
 * comparison is always against the note in the editor.
 */
export function CompareMenuItem({ filePath, onDone }: { filePath: string; onDone: () => void }) {
  const { t } = useTranslation();
  const layout = useLayoutMode();
  const selectedFilePath = useAppStore((state) => state.selectedFilePath);
  const open = useCompareStore((state) => state.open);

  if (layout !== "desktop") {
    return null;
  }

  const disabled = selectedFilePath === null || samePath(selectedFilePath, filePath);

  return (
    <button
      type="button"
      role="menuitem"
      className="file-tree-context-menu__item"
      disabled={disabled}
      title={disabled ? t("compare.menuDisabledHint") : undefined}
      data-testid="compare-menu-item"
      onClick={() => {
        open(filePath);
        onDone();
      }}
    >
      <Columns2 aria-hidden="true" />
      {t("compare.menuItem")}
    </button>
  );
}
