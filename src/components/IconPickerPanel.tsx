import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { loadIconGlyphs } from "@/lib/customFonts";
import type { IconGlyph } from "@/lib/fontFile";
import { ensureFontStylesLoaded, type CustomFontDefinition } from "@/lib/fonts";
import { nextGridIndex } from "@/lib/iconGridNav";
import { codepointLabel, filterGlyphs, glyphGroups, glyphLabel } from "@/lib/iconSearch";
import { readRecentIcons, rememberIcon } from "@/lib/recentIcons";

const COLUMNS = 9;
const CELL_PX = 36;
const VIEWPORT_PX = 300;
const OVERSCAN_ROWS = 3;
const PAGE_ROWS = Math.floor(VIEWPORT_PX / CELL_PX);

const cellTitle = (glyph: IconGlyph) => glyphLabel(glyph) + " (" + codepointLabel(glyph.codepoint) + ")";

type IconGridProps = {
  glyphs: IconGlyph[];
  family: string;
  onPick: (glyph: IconGlyph) => void;
  onHover: (glyph: IconGlyph | null) => void;
  /** Arrow up out of the first row. */
  onLeaveUp: () => void;
};

/**
 * A grid that only builds the rows in view. A Nerd Font has some ten thousand
 * icons; as buttons all at once they would make opening the picker take
 * seconds. The scroll height is the full height, so the scrollbar is honest.
 *
 * One tab stop, arrow keys inside: the focus lives in an index, not in a
 * button, because the button of a row that has scrolled out of view does not
 * exist.
 */
function IconGrid({ glyphs, family, onPick, onHover, onLeaveUp }: IconGridProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [focusIndex, setFocusIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const moveFocusRef = useRef(false);
  const rows = Math.ceil(glyphs.length / COLUMNS);
  const firstRow = Math.max(0, Math.floor(scrollTop / CELL_PX) - OVERSCAN_ROWS);
  const lastRow = Math.min(rows, Math.ceil((scrollTop + VIEWPORT_PX) / CELL_PX) + OVERSCAN_ROWS);
  const firstIndex = firstRow * COLUMNS;
  const visible = glyphs.slice(firstIndex, lastRow * COLUMNS);
  // Scrolled with the wheel past the focused icon: the first built cell takes
  // the tab stop over, so Tab still lands in the grid.
  const tabStop = focusIndex >= firstIndex && focusIndex < firstIndex + visible.length ? focusIndex : firstIndex;

  // After an arrow key: bring the row into view, then focus its button once
  // the scroll has rebuilt the rows around it.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;

    if (!scroller || !moveFocusRef.current) {
      return;
    }

    const rowTop = Math.floor(focusIndex / COLUMNS) * CELL_PX;

    if (rowTop < scroller.scrollTop) {
      scroller.scrollTop = rowTop;
    } else if (rowTop + CELL_PX > scroller.scrollTop + VIEWPORT_PX) {
      scroller.scrollTop = rowTop + CELL_PX - VIEWPORT_PX;
    }

    const button = scroller.querySelector<HTMLButtonElement>('[data-index="' + focusIndex + '"]');

    if (button) {
      button.focus();
      moveFocusRef.current = false;
    }
  }, [focusIndex, scrollTop]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.metaKey) {
      return;
    }

    const target = nextGridIndex(event.key, event.ctrlKey, focusIndex, glyphs.length, COLUMNS, PAGE_ROWS);

    if (target === "leave-up") {
      event.preventDefault();
      onLeaveUp();
      return;
    }

    if (target !== null) {
      event.preventDefault();
      moveFocusRef.current = true;
      setFocusIndex(target);
    }
  };

  return (
    <div
      ref={scrollRef}
      className="icon-picker__grid"
      style={{ height: VIEWPORT_PX }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onMouseLeave={() => onHover(null)}
      onKeyDown={handleKeyDown}
    >
      <div style={{ height: rows * CELL_PX, position: "relative" }}>
        <div
          className="icon-picker__rows"
          style={{ top: firstRow * CELL_PX, gridTemplateColumns: "repeat(" + COLUMNS + ", " + CELL_PX + "px)" }}
        >
          {visible.map((glyph, offset) => {
            const index = firstIndex + offset;

            return (
              <button
                key={glyph.codepoint}
                type="button"
                data-index={index}
                tabIndex={index === tabStop ? 0 : -1}
                className="icon-picker__cell"
                style={{ fontFamily: family }}
                title={cellTitle(glyph)}
                aria-label={glyphLabel(glyph)}
                onMouseEnter={() => onHover(glyph)}
                onFocus={() => {
                  setFocusIndex(index);
                  onHover(glyph);
                }}
                onClick={() => onPick(glyph)}
              >
                {String.fromCodePoint(glyph.codepoint)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Moves the focus along a row of buttons with the arrow keys. */
function stepFocus(event: KeyboardEvent<HTMLElement>, selector: string): boolean {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
    return false;
  }

  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(selector)];
  const current = items.indexOf(document.activeElement as HTMLButtonElement);

  event.preventDefault();
  items[Math.min(items.length - 1, Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1)))]?.focus();

  return true;
}

type IconPickerPanelProps = {
  /** The imported fonts that carry icons; never empty. */
  fonts: CustomFontDefinition[];
  onPick: (character: string) => void;
};

/**
 * The icons of the imported icon fonts, with search. The catalogue is read
 * from the font file itself (lib/fontFile.ts), so any icon font works the
 * moment it is imported.
 *
 * Keyboard: Tab goes search, recent row, grid (one stop each) and then the
 * icon-set chips, which come last in the tab order although they sit above
 * the grid; Down from the search enters the grid, arrows move inside it.
 */
export function IconPickerPanel({ fonts, onPick }: IconPickerPanelProps) {
  const { t } = useTranslation();
  const [fontId, setFontId] = useState(fonts[0].id);
  const font = fonts.find((candidate) => candidate.id === fontId) ?? fonts[0];
  const [glyphs, setGlyphs] = useState<IconGlyph[] | null>(null);
  const [query, setQuery] = useState("");
  const [prefix, setPrefix] = useState<string | null>(null);
  const [hovered, setHovered] = useState<IconGlyph | null>(null);
  const [recent, setRecent] = useState<number[]>(() => readRecentIcons(font.id));
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    setGlyphs(null);
    setQuery("");
    setPrefix(null);
    setRecent(readRecentIcons(font.id));
    void ensureFontStylesLoaded(font.id);
    loadIconGlyphs(font)
      .then((loaded) => !cancelled && setGlyphs(loaded))
      .catch(() => !cancelled && setGlyphs([]));

    return () => {
      cancelled = true;
    };
  }, [font]);

  useEffect(() => {
    searchRef.current?.focus();
  }, [glyphs]);

  // The name under the grid belongs to the icon last pointed at; a new search
  // or icon set shows a different list, so it goes back to the count.
  useEffect(() => {
    setHovered(null);
  }, [query, prefix]);

  const groups = useMemo(() => glyphGroups(glyphs ?? []), [glyphs]);
  const filtered = useMemo(() => filterGlyphs(glyphs ?? [], query, prefix), [glyphs, query, prefix]);
  const byCodepoint = useMemo(() => new Map((glyphs ?? []).map((glyph) => [glyph.codepoint, glyph])), [glyphs]);
  const recentGlyphs = recent.flatMap((codepoint) => byCodepoint.get(codepoint) ?? []);
  const showRecent = query === "" && prefix === null && recentGlyphs.length > 0;

  const pick = (glyph: IconGlyph) => {
    rememberIcon(font.id, glyph.codepoint);
    onPick(String.fromCodePoint(glyph.codepoint));
  };

  const focusStop = (selector: string) =>
    panelRef.current?.querySelector<HTMLButtonElement>(selector + '[tabindex="0"]')?.focus();
  /** The first icon the keyboard can land on: the recent row, else the grid. */
  const focusFirstIcon = () => focusStop(".icon-picker__cell");

  return (
    <div ref={panelRef} className="icon-picker">
      {fonts.length > 1 ? (
        <select
          className="icon-picker__font"
          style={{ order: 0 }}
          value={font.id}
          aria-label={t("emojiPicker.iconFont")}
          onChange={(event) => setFontId(event.target.value as typeof fontId)}
        >
          {fonts.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label ?? candidate.familyName}
            </option>
          ))}
        </select>
      ) : null}

      <label className="icon-picker__search" style={{ order: 1 }}>
        <Search className="size-4" aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder={t("emojiPicker.iconSearch")}
          aria-label={t("emojiPicker.iconSearch")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusFirstIcon();
            }
          }}
        />
      </label>

      {glyphs === null ? (
        <p className="icon-picker__note" role="status" style={{ order: 4 }}>
          {t("emojiPicker.iconLoading")}
        </p>
      ) : (
        <>
          {showRecent ? (
            <div
              className="icon-picker__recent"
              style={{ order: 3 }}
              role="group"
              aria-label={t("emojiPicker.iconRecent")}
              onKeyDown={(event) => {
                if (stepFocus(event, ".icon-picker__cell")) {
                  return;
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  searchRef.current?.focus();
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusStop(".icon-picker__grid .icon-picker__cell");
                }
              }}
            >
              {recentGlyphs.map((glyph, index) => (
                <button
                  key={glyph.codepoint}
                  type="button"
                  tabIndex={index === 0 ? 0 : -1}
                  className="icon-picker__cell"
                  style={{ fontFamily: font.cssStack }}
                  title={cellTitle(glyph)}
                  aria-label={glyphLabel(glyph)}
                  onMouseEnter={() => setHovered(glyph)}
                  onFocus={() => setHovered(glyph)}
                  onClick={() => pick(glyph)}
                >
                  {String.fromCodePoint(glyph.codepoint)}
                </button>
              ))}
            </div>
          ) : null}

          {filtered.length === 0 ? (
            <p className="icon-picker__note" style={{ order: 4 }}>
              {t("emojiPicker.iconEmpty")}
            </p>
          ) : (
            <div style={{ order: 4 }}>
              <IconGrid
                // A new search starts at the top, not wherever the last one was scrolled to.
                key={query + "|" + prefix}
                glyphs={filtered}
                family={font.cssStack}
                onPick={pick}
                onHover={setHovered}
                onLeaveUp={() => (showRecent ? focusFirstIcon() : searchRef.current?.focus())}
              />
            </div>
          )}

          <p className="icon-picker__preview" style={{ order: 5 }} aria-live="polite">
            {hovered
              ? glyphLabel(hovered) + " · " + codepointLabel(hovered.codepoint)
              : t("emojiPicker.iconCount", { count: filtered.length })}
          </p>

          {groups.length > 0 ? (
            // After the grid in the document, so Tab reaches the icons first;
            // `order` puts it back under the search where it is seen.
            <div
              className="icon-picker__groups"
              style={{ order: 2 }}
              role="group"
              aria-label={t("emojiPicker.iconSets")}
              onKeyDown={(event) => stepFocus(event, ".icon-picker__chip")}
            >
              <button
                type="button"
                tabIndex={prefix === null ? 0 : -1}
                className="icon-picker__chip"
                data-selected={prefix === null ? "true" : undefined}
                onClick={() => setPrefix(null)}
              >
                {t("emojiPicker.iconAll")}
              </button>
              {groups.map((group) => (
                <button
                  key={group.prefix}
                  type="button"
                  tabIndex={prefix === group.prefix ? 0 : -1}
                  className="icon-picker__chip"
                  data-selected={prefix === group.prefix ? "true" : undefined}
                  onClick={() => setPrefix(prefix === group.prefix ? null : group.prefix)}
                >
                  {group.prefix}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
