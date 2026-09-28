import { useTranslation } from "react-i18next";

import { MenuCheckboxItem, MenuCheckboxItemIndicator, MenuShortcut } from "@/components/ui/menu";
import { useShortcutLabel } from "@/hooks/useShortcutLabel";
import { PAGE_SIZE_SHORT_LABELS } from "@/lib/pageSetup";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

/**
 * "Show page breaks (PDF, A4)" in the editor's options menu and the document
 * menu. The label names the paper, so a line on screen is never read against
 * a different format than the one the PDF will have. `showShortcut` is off in
 * the touch-screen document menu, which names no key combinations.
 */
export function PageLinesMenuItem({ showShortcut = true }: { showShortcut?: boolean }) {
  const { t } = useTranslation();
  const pageLinesEnabled = useEditorSettingsStore((state) => state.pageLinesEnabled);
  const setPageLinesEnabled = useEditorSettingsStore((state) => state.setPageLinesEnabled);
  const pageSize = useEditorSettingsStore((state) => state.pageSize);
  // No combo out of the box; shown once the user assigns one.
  const shortcut = useShortcutLabel("togglePageLines");

  return (
    <MenuCheckboxItem
      checked={pageLinesEnabled}
      onCheckedChange={(checked) => setPageLinesEnabled(checked)}
      title={t("editor.pageLineHint")}
    >
      {t("toolbar.pageLinesToggle", { size: PAGE_SIZE_SHORT_LABELS[pageSize] })}
      {showShortcut && shortcut ? <MenuShortcut>{shortcut}</MenuShortcut> : null}
      <MenuCheckboxItemIndicator />
    </MenuCheckboxItem>
  );
}
