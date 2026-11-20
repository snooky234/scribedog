import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { Bookmark, MessageSquare, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DetailsSection } from "@/components/editor/DetailsSection";
import { Button } from "@/components/ui/button";
import {
  listPlacemarks,
  removePlacemark,
  revealPlacemark,
  setPlacemarkComment,
  type PlacemarkInfo
} from "@/lib/editor/placemarkPlugin";
import { PLACEMARK_COMMENT_MAX_LENGTH } from "@/lib/placemarks";
import { formatBinding } from "@/lib/shortcuts/binding";
import { resolveBinding } from "@/lib/shortcuts/resolve";
import { useShortcutsStore } from "@/store/useShortcutsStore";

/** A mark the gutter asked for (a right click on a marked bar). */
export type PlacemarkFocusRequest = {
  pos: number;
  id: number;
};

type DetailsPlacemarksSectionProps = {
  editor: TipTapEditor | null;
  focusRequest: PlacemarkFocusRequest | null;
  onFocusRequestHandled: () => void;
  onRequestEditorFocus: () => void;
};

const FLASH_MS = 1600;

function samePlacemarks(a: PlacemarkInfo[], b: PlacemarkInfo[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (mark, index) =>
        mark.pos === b[index].pos &&
        mark.blockNumber === b[index].blockNumber &&
        mark.quote === b[index].quote &&
        mark.comment === b[index].comment
    )
  );
}

/** The open note's placemarks, kept current from the editor's transactions. */
function usePlacemarkList(editor: TipTapEditor | null): PlacemarkInfo[] {
  const [placemarks, setPlacemarks] = useState<PlacemarkInfo[]>([]);

  useEffect(() => {
    if (!editor) {
      setPlacemarks([]);
      return;
    }

    let current: PlacemarkInfo[] = [];

    const refresh = () => {
      if (editor.isDestroyed) {
        return;
      }

      const next = listPlacemarks(editor.state);

      if (!samePlacemarks(current, next)) {
        current = next;
        setPlacemarks(next);
      }
    };

    refresh();
    editor.on("transaction", refresh);

    return () => {
      editor.off("transaction", refresh);
    };
  }, [editor]);

  return placemarks;
}

/**
 * Placemarks (issue #91): the blocks marked in the open note, each with its
 * number, the start of its text and its comment. A click jumps there without
 * taking the focus out of the panel, the way the outline does. A right click
 * on a marked bar in the gutter lands here: the entry is scrolled into view,
 * flashes and opens its comment, and finishing the comment hands the focus
 * back to the note it came from.
 */
export function DetailsPlacemarksSection({
  editor,
  focusRequest,
  onFocusRequestHandled,
  onRequestEditorFocus
}: DetailsPlacemarksSectionProps) {
  const { t } = useTranslation();
  const placemarks = usePlacemarkList(editor);
  const overrides = useShortcutsStore((state) => state.overrides);
  const [editingPos, setEditingPos] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const cancelledRef = useRef(false);
  const returnFocusRef = useRef(false);
  const [flashPos, setFlashPos] = useState<number | null>(null);
  const itemRefs = useRef(new Map<number, HTMLLIElement>());

  // A mark that moved or vanished while its comment was open ends the edit.
  useEffect(() => {
    if (editingPos !== null && !placemarks.some((mark) => mark.pos === editingPos)) {
      setEditingPos(null);
    }
  }, [placemarks, editingPos]);

  const startEditing = (mark: PlacemarkInfo, returnFocus = false) => {
    cancelledRef.current = false;
    returnFocusRef.current = returnFocus;
    setEditingPos(mark.pos);
    setDraft(mark.comment);
  };

  // Handled once the list holds the mark: the panel may only just be
  // opening, and its list fills from the editor after the first render.
  useEffect(() => {
    if (!focusRequest) {
      return;
    }

    const mark = placemarks.find((entry) => entry.pos === focusRequest.pos);

    if (!mark) {
      return;
    }

    onFocusRequestHandled();
    startEditing(mark, true);
    setFlashPos(mark.pos);
    itemRefs.current.get(mark.pos)?.scrollIntoView({ block: "nearest" });
  }, [focusRequest, placemarks, onFocusRequestHandled]);

  useEffect(() => {
    if (flashPos === null) {
      return;
    }

    const timer = window.setTimeout(() => setFlashPos(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashPos]);

  // Enter and Escape go back to the note when the gutter opened the edit;
  // a blur means the reader already went somewhere else.
  const endEditing = (byKey: boolean) => {
    setEditingPos(null);

    if (returnFocusRef.current && byKey) {
      onRequestEditorFocus();
    }

    returnFocusRef.current = false;
  };

  const commit = (byKey = false) => {
    // Escape already ended the edit; the blur that follows the textarea's
    // removal must not save what Escape discarded.
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }

    if (editor && editingPos !== null) {
      setPlacemarkComment(editor, editingPos, draft);
    }

    endEditing(byKey);
  };

  const handleCommentKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelledRef.current = true;
      endEditing(true);
    }
  };

  return (
    <DetailsSection id="placemarks" title={t("detailsPanel.placemarks", { count: placemarks.length })}>
      {placemarks.length === 0 ? (
        <p className="details-sidebar__empty">
          {t("detailsPanel.noPlacemarks", { keys: formatBinding(t, resolveBinding(overrides, "togglePlacemark")) })}
        </p>
      ) : (
        <ul className="details-sidebar__list" aria-label={t("detailsPanel.placemarksAriaLabel")}>
          {placemarks.map((mark) => (
            <li
              key={mark.pos}
              ref={(element) => {
                if (element) {
                  itemRefs.current.set(mark.pos, element);
                } else {
                  itemRefs.current.delete(mark.pos);
                }
              }}
              className={
                flashPos === mark.pos
                  ? "details-sidebar__placemark details-sidebar__placemark--flash"
                  : "details-sidebar__placemark"
              }
            >
              <div className="details-sidebar__placemark-row">
                <button
                  type="button"
                  className="details-sidebar__item"
                  title={mark.quote || undefined}
                  onClick={() => editor && revealPlacemark(editor, mark.pos, false)}
                >
                  <Bookmark aria-hidden="true" />
                  <span className="details-sidebar__placemark-number">{mark.blockNumber}</span>
                  <span
                    className={
                      mark.quote
                        ? "details-sidebar__item-label"
                        : "details-sidebar__item-label details-sidebar__item-label--muted"
                    }
                  >
                    {mark.quote || t("detailsPanel.placemarkNoText")}
                  </span>
                </button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="details-sidebar__placemark-action"
                  aria-label={t("detailsPanel.placemarkEditComment")}
                  title={t("detailsPanel.placemarkEditComment")}
                  onClick={() => startEditing(mark)}
                >
                  <MessageSquare />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="details-sidebar__placemark-action"
                  aria-label={t("detailsPanel.placemarkRemove")}
                  title={t("detailsPanel.placemarkRemove")}
                  onClick={() => editor && removePlacemark(editor, mark.pos)}
                >
                  <X />
                </Button>
              </div>

              {editingPos === mark.pos ? (
                <textarea
                  className="details-sidebar__placemark-input"
                  value={draft}
                  maxLength={PLACEMARK_COMMENT_MAX_LENGTH}
                  rows={2}
                  autoFocus
                  aria-label={t("detailsPanel.placemarkCommentLabel")}
                  placeholder={t("detailsPanel.placemarkCommentPlaceholder")}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleCommentKeyDown}
                  onBlur={() => commit()}
                />
              ) : mark.comment ? (
                <button
                  type="button"
                  className="details-sidebar__placemark-comment"
                  title={t("detailsPanel.placemarkEditComment")}
                  onClick={() => startEditing(mark)}
                >
                  {mark.comment}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </DetailsSection>
  );
}
