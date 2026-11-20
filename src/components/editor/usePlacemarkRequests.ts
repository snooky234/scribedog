import { useCallback, useEffect, useState } from "react";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor as TipTapEditor } from "@tiptap/react";

import type { PlacemarkFocusRequest } from "@/components/editor/DetailsPlacemarksSection";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { placemarkRevealRequest, removedPlacemark, restoreRemovedPlacemark } from "@/lib/editor/placemarkPlugin";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

/** How long the undo offer for a removed comment stays on screen. */
export const PLACEMARK_UNDO_MS = 10_000;

/**
 * The two ways placemarks reach outside the editor (issue #91 follow-up).
 * A right click on a marked bar opens the details panel (or the sheet on
 * phone and tablet) at that mark, unfolding its section. And a mark removed
 * with its comment offers an undo for a while, since the removal is not in
 * the document's history and the comment is the reader's own writing.
 */
export function usePlacemarkRequests(editor: TipTapEditor | null) {
  const layout = useLayoutMode();
  const [focusRequest, setFocusRequest] = useState<PlacemarkFocusRequest | null>(null);
  const [removedId, setRemovedId] = useState<number | null>(null);
  const [dismissedId, setDismissedId] = useState<number | null>(null);

  useEffect(() => {
    if (!editor) {
      return;
    }

    let nextRequestId = 1;

    const handleTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (editor.isDestroyed) {
        return;
      }

      setRemovedId(removedPlacemark(editor.state)?.id ?? null);

      const pos = placemarkRevealRequest(transaction);

      if (pos === null) {
        return;
      }

      const settings = useEditorSettingsStore.getState();
      settings.setDetailsSectionCollapsed("placemarks", false);

      if (layout === "desktop") {
        settings.setDetailsPanelVisible(true);
      } else {
        settings.setDetailsSheetOpen(true);
      }

      setFocusRequest({ pos, id: nextRequestId++ });
    };

    editor.on("transaction", handleTransaction);

    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor, layout]);

  const undoVisible = removedId !== null && removedId !== dismissedId;

  useEffect(() => {
    if (!undoVisible) {
      return;
    }

    const timer = window.setTimeout(() => setDismissedId(removedId), PLACEMARK_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undoVisible, removedId]);

  const handleFocusRequestHandled = useCallback(() => setFocusRequest(null), []);

  return {
    placemarkFocusRequest: focusRequest,
    onPlacemarkFocusRequestHandled: handleFocusRequestHandled,
    placemarkUndoVisible: undoVisible,
    undoPlacemarkRemoval: () => {
      setDismissedId(removedId);

      if (editor) {
        restoreRemovedPlacemark(editor);
      }
    },
    dismissPlacemarkUndo: () => setDismissedId(removedId)
  };
}
