import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { FileLinkOptionList } from "@/components/editor/FileLinkOptionList";
import type { FileLinkSuggestionState } from "@/components/editor/useFileLinkSuggestion";
import type { VaultFileOption } from "@/lib/editor/fileLinks";

type FileLinkSuggestionPopoverProps = {
  suggestion: FileLinkSuggestionState;
  onSelect: (option: VaultFileOption) => void;
  onActiveIndexChange: (index: number) => void;
};

const POPOVER_WIDTH_PX = 340;
const POPOVER_MAX_HEIGHT_PX = 260;
const CARET_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

/**
 * The "[[" picker, anchored to the caret. Rendered into document.body because
 * the editor's scroll container would clip a popup that opens near its edge;
 * the coordinates come from the ProseMirror view and are therefore viewport
 * based (position: fixed).
 */
export function FileLinkSuggestionPopover({
  suggestion,
  onSelect,
  onActiveIndexChange
}: FileLinkSuggestionPopoverProps) {
  const { t } = useTranslation();
  const { coords } = suggestion;
  const left = Math.max(
    VIEWPORT_MARGIN_PX,
    Math.min(coords.left, window.innerWidth - POPOVER_WIDTH_PX - VIEWPORT_MARGIN_PX)
  );
  // Opens below the caret and flips above it when the line sits too low.
  const opensUpwards = coords.bottom + POPOVER_MAX_HEIGHT_PX + VIEWPORT_MARGIN_PX > window.innerHeight;

  return createPortal(
    <div
      className="file-link-suggest"
      style={{
        left,
        width: POPOVER_WIDTH_PX,
        ...(opensUpwards
          ? { bottom: window.innerHeight - coords.top + CARET_GAP_PX }
          : { top: coords.bottom + CARET_GAP_PX })
      }}
    >
      <p className="file-link-suggest__hint">{t("fileLinkSuggest.hint")}</p>
      <FileLinkOptionList
        options={suggestion.options}
        activeIndex={suggestion.activeIndex}
        emptyLabel={t("fileLinkSuggest.noMatches")}
        block="file-link-suggest"
        listId="file-link-suggest-list"
        onSelect={onSelect}
        onActiveIndexChange={onActiveIndexChange}
      />
    </div>,
    document.body
  );
}
