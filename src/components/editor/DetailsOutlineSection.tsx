import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { DetailsSection, useDetailsSectionCollapsed } from "@/components/editor/DetailsSection";
import type { OutlineHeading } from "@/lib/editor/documentOutline";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

type DetailsOutlineSectionProps = {
  headings: OutlineHeading[];
  /** Index of the heading the reader is in, -1 when none. */
  activeIndex: number;
  /** Bumped when the editor hands focus over (Tab); lands on the active heading. */
  focusRequestId: number;
  onJump: (heading: OutlineHeading) => void;
  /** Escape / Shift+Tab: back to the document without jumping. */
  onRequestEditorFocus: () => void;
};

// Private Use codepoints, i.e. glyphs of an imported icon font (see isGlyphIcon).
const ICON_GLYPH_RUN = /([-\u{F0000}-\u{10FFFD}]+)/u;

/**
 * An icon font glyph is drawn wider than its font reserves for it (a Nerd Font
 * icon runs up to the full em on a 0.6em advance) and would cover the space
 * after it, so each run of them gets its own span that adds the room back.
 */
function renderOutlineTitle(title: string) {
  if (!ICON_GLYPH_RUN.test(title)) {
    return title;
  }

  return title.split(ICON_GLYPH_RUN).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="details-sidebar__outline-glyph">
        {part}
      </span>
    ) : (
      part
    )
  );
}

/**
 * The document's headings as a clickable outline. Deliberately knows nothing
 * about the editor — it gets a list and a jump callback — so the same list can
 * later sit somewhere else (the file tree, a vault-wide search) unchanged.
 *
 * Keyboard: the list is one tab stop (roving tabindex), arrows move within it,
 * Enter jumps, Escape and Shift+Tab return to the document.
 */
export function DetailsOutlineSection({
  headings,
  activeIndex,
  focusRequestId,
  onJump,
  onRequestEditorFocus
}: DetailsOutlineSectionProps) {
  const { t } = useTranslation();
  const collapsed = useDetailsSectionCollapsed("outline");
  const setSectionCollapsed = useEditorSettingsStore((state) => state.setDetailsSectionCollapsed);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Which item Tab lands on next; follows the reader until they move it.
  const [focusedIndex, setFocusedIndex] = useState(0);
  const lastHandledFocusRequestRef = useRef(focusRequestId);
  // A focus request made while the section was folded is honoured once the
  // items exist: a folded list has nothing to focus.
  const [pendingFocus, setPendingFocus] = useState(false);

  const clampIndex = (index: number) => Math.min(headings.length - 1, Math.max(0, index));

  // The tab stop follows the reader, not the user's last arrow position: after
  // the cursor or the scroll moved elsewhere, Tab should land on that section.
  useEffect(() => {
    setFocusedIndex(clampIndex(activeIndex));
  }, [activeIndex, headings.length]);

  // Keeps the current section in view while the document is scrolled, without
  // yanking the outline around when the user is already reading it.
  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }

    const item = itemRefs.current[activeIndex];

    if (item && document.activeElement !== item && !item.contains(document.activeElement)) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  useEffect(() => {
    if (lastHandledFocusRequestRef.current === focusRequestId) {
      return;
    }

    lastHandledFocusRequestRef.current = focusRequestId;
    setPendingFocus(true);

    if (collapsed) {
      setSectionCollapsed("outline", false);
    }
  }, [focusRequestId, collapsed, setSectionCollapsed]);

  useEffect(() => {
    if (!pendingFocus || collapsed) {
      return;
    }

    setPendingFocus(false);

    if (headings.length === 0) {
      return;
    }

    const target = clampIndex(activeIndex);
    setFocusedIndex(target);
    itemRefs.current[target]?.focus();
  }, [pendingFocus, collapsed, headings.length, activeIndex]);

  // Moving jumps immediately, the same way the file tree's arrow keys open a
  // file as you move to it — no separate "confirm with Enter" step, and no
  // focus ring distinct from the moving highlight itself.
  const moveFocus = (index: number) => {
    const next = clampIndex(index);
    setFocusedIndex(next);
    itemRefs.current[next]?.focus();
    onJump(headings[next]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveFocus(focusedIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(focusedIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        moveFocus(0);
        break;
      case "End":
        event.preventDefault();
        moveFocus(headings.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        onRequestEditorFocus();
        break;
      case "Tab":
        if (event.shiftKey) {
          event.preventDefault();
          onRequestEditorFocus();
        }
        break;
      default:
        break;
    }
  };

  return (
    <DetailsSection id="outline" title={t("detailsPanel.outline", { count: headings.length })}>
      {headings.length === 0 ? (
        <p className="details-sidebar__empty">{t("detailsPanel.noOutline")}</p>
      ) : (
        <ul
          className="details-sidebar__list details-sidebar__outline"
          aria-label={t("detailsPanel.outlineAriaLabel")}
          onKeyDown={handleKeyDown}
        >
          {headings.map((heading, index) => (
            <li key={heading.pos}>
              <button
                type="button"
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                tabIndex={index === focusedIndex ? 0 : -1}
                className="details-sidebar__item details-sidebar__outline-item"
                style={{ "--outline-level": heading.level } as CSSProperties}
                data-level={heading.level}
                data-active={index === activeIndex ? "true" : undefined}
                aria-current={index === activeIndex ? "location" : undefined}
                title={heading.title || undefined}
                onFocus={() => setFocusedIndex(index)}
                onClick={() => onJump(heading)}
              >
                <span
                  className={
                    heading.title
                      ? "details-sidebar__item-label"
                      : "details-sidebar__item-label details-sidebar__item-label--muted"
                  }
                >
                  {heading.number && (
                    <span className="details-sidebar__outline-number">{heading.number}</span>
                  )}
                  {heading.title ? renderOutlineTitle(heading.title) : t("detailsPanel.untitledHeading")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </DetailsSection>
  );
}
