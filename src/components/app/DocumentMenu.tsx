import { useState, type RefObject } from "react";
import {
  ArrowLeft,
  ArrowRight,
  EllipsisVertical,
  FileCode,
  Focus,
  History,
  Printer,
  Search,
  Type,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { EditorHandle } from "@/components/Editor";
import type { SelectionRange } from "@/lib/editor/selectionClipboard";
import { PageLinesMenuItem } from "@/components/PageLinesMenuItem";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger
} from "@/components/ui/menu";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";

type DocumentMenuProps = {
  editorHandleRef: RefObject<EditorHandle | null>;
  backTargetLabel: string | null;
  forwardTargetLabel: string | null;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onVersionsRequest: () => void;
  versioningEnabled: boolean;
  onZenModeRequest: () => void;
};

/**
 * The document header's "more" menu on phone and tablet. It holds what the
 * toolbar's view group (find, details, zoom, zen, print, spellcheck) offers on
 * the desktop, where that group is hidden to keep the bottom toolbar to one
 * swipeable row, plus what the phone header has no room for (back/forward,
 * versions). Every entry is a shortcut's only visible trigger on a touch
 * screen, which is why none of them is left out, and by the same rule the two
 * ways of copying a selection that the system's own copy button does not
 * cover. Hidden at desktop width (responsive.css); the phone-only entries are
 * hidden on the tablet. No entry names its key combination: on a touch screen
 * there is usually no keyboard to press it on.
 */
export function DocumentMenu({
  editorHandleRef,
  backTargetLabel,
  forwardTargetLabel,
  onNavigateBack,
  onNavigateForward,
  onVersionsRequest,
  versioningEnabled,
  onZenModeRequest
}: DocumentMenuProps) {
  const { t } = useTranslation();
  const openFindPanel = useSearchStore((state) => state.openPanel);
  // Taken as the menu opens, because that is the last moment the editor still
  // has the selection: the focus moves into the popup and ProseMirror
  // collapses its selection when the editor is blurred.
  const [copyRange, setCopyRange] = useState<SelectionRange | null>(null);
  const detailsSheetOpen = useEditorSettingsStore((state) => state.detailsSheetOpen);
  const setDetailsSheetOpen = useEditorSettingsStore((state) => state.setDetailsSheetOpen);
  const spellcheckEnabled = useEditorSettingsStore((state) => state.spellcheckEnabled);
  const setSpellcheckEnabled = useEditorSettingsStore((state) => state.setSpellcheckEnabled);
  const autoSaveEnabled = useEditorSettingsStore((state) => state.autoSaveEnabled);
  const setAutoSaveEnabled = useEditorSettingsStore((state) => state.setAutoSaveEnabled);
  const zoomLevel = useEditorSettingsStore((state) => state.zoomLevel);
  const setZoomLevel = useEditorSettingsStore((state) => state.setZoomLevel);

  return (
    <Menu
      onOpenChange={(open) => {
        setCopyRange(open ? (editorHandleRef.current?.getSelectionRange() ?? null) : null);
      }}
    >
      <MenuTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="detail-panel__menu-trigger"
            aria-label={t("app.documentMenu")}
            title={t("app.documentMenu")}
            data-testid="document-menu"
          />
        }
      >
        <EllipsisVertical />
      </MenuTrigger>
      <MenuPortal>
        <MenuPositioner align="end">
          <MenuPopup className="document-menu">
            <MenuItem
              className="document-menu__item--phone"
              disabled={backTargetLabel === null}
              onClick={onNavigateBack}
            >
              <ArrowLeft className="size-4" />
              {backTargetLabel
                ? t("app.navigateBackTo", { fileLabel: backTargetLabel })
                : t("app.navigateBack")}
            </MenuItem>
            <MenuItem
              className="document-menu__item--phone"
              disabled={forwardTargetLabel === null}
              onClick={onNavigateForward}
            >
              <ArrowRight className="size-4" />
              {forwardTargetLabel
                ? t("app.navigateForwardTo", { fileLabel: forwardTargetLabel })
                : t("app.navigateForward")}
            </MenuItem>
            {versioningEnabled ? (
              <MenuItem className="document-menu__item--phone" onClick={onVersionsRequest}>
                <History className="size-4" />
                {t("versions.buttonLabel")}
              </MenuItem>
            ) : null}
            <div className="editor-toolbar__menu-separator document-menu__item--phone" role="separator" />

            {/* The only selection-scoped entries here. On a touch screen the
                right mouse button's selection menu is deliberately not opened
                by a long press, since that is how a word gets selected there,
                so these fixed shortcuts would have no visible trigger at all.
                "Copy with formatting" is left out: that is what the system's
                own copy button on the selection already puts on the clipboard,
                and unlike these two it would need the editor's focus back. */}
            <MenuItem
              disabled={copyRange === null}
              onClick={() => copyRange && editorHandleRef.current?.copyRange(copyRange, "markdown")}
            >
              <FileCode className="size-4" />
              {t("editorContextMenu.copyMarkdown")}
            </MenuItem>
            <MenuItem
              disabled={copyRange === null}
              onClick={() => copyRange && editorHandleRef.current?.copyRange(copyRange, "plainText")}
            >
              <Type className="size-4" />
              {t("editorContextMenu.copyPlainText")}
            </MenuItem>
            <div className="editor-toolbar__menu-separator" role="separator" />

            <MenuItem onClick={() => openFindPanel()}>
              <Search className="size-4" />
              {t("findReplace.openButton")}
            </MenuItem>
            <MenuCheckboxItem
              checked={detailsSheetOpen}
              onCheckedChange={(checked) => setDetailsSheetOpen(checked)}
            >
              {t("toolbar.detailsPanel")}
              <MenuCheckboxItemIndicator />
            </MenuCheckboxItem>
            <MenuItem onClick={onZenModeRequest}>
              <Focus className="size-4" />
              {t("toolbar.zenModeButton")}
            </MenuItem>
            <div className="editor-toolbar__menu-separator" role="separator" />

            <MenuItem
              closeOnClick={false}
              disabled={zoomLevel >= ZOOM_MAX}
              onClick={() => setZoomLevel(zoomLevel + ZOOM_STEP)}
            >
              <ZoomIn className="size-4" />
              {t("zoomControl.zoomInLabel")}
            </MenuItem>
            <MenuItem
              closeOnClick={false}
              disabled={zoomLevel <= ZOOM_MIN}
              onClick={() => setZoomLevel(zoomLevel - ZOOM_STEP)}
            >
              <ZoomOut className="size-4" />
              {t("zoomControl.zoomOutLabel")}
            </MenuItem>
            <MenuItem disabled={zoomLevel === 0} onClick={() => setZoomLevel(0)}>
              <span className="size-4" aria-hidden="true" />
              {t("zoomControl.resetLabel")}
            </MenuItem>
            <div className="editor-toolbar__menu-separator" role="separator" />

            <MenuCheckboxItem
              checked={autoSaveEnabled}
              onCheckedChange={(checked) => setAutoSaveEnabled(checked)}
              data-testid="auto-save-toggle"
            >
              {t("toolbar.autoSaveToggle")}
              <MenuCheckboxItemIndicator />
            </MenuCheckboxItem>
            <MenuCheckboxItem
              checked={spellcheckEnabled}
              onCheckedChange={(checked) => setSpellcheckEnabled(checked)}
            >
              {t("toolbar.spellcheckToggle")}
              <MenuCheckboxItemIndicator />
            </MenuCheckboxItem>
            <PageLinesMenuItem showShortcut={false} />
            <MenuItem onClick={() => editorHandleRef.current?.printDocument()}>
              <Printer className="size-4" />
              {t("toolbar.printButton")}
            </MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
}
