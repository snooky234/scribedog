// The page inside the editor card can be pulled narrower at either edge
// (PageWidthHandles.tsx). Its width is kept in em of the document text, so
// it holds the same text when the text size changes. Pulled back to the
// card's edge it docks: null, the full width. A stored width wider than the
// card leaves the page docked too (CSS max-width), without overflow, until
// the window has the room again.

export const PAGE_WIDTH_MIN_EM = 20;
export const PAGE_WIDTH_STEP_EM = 2;
/** How close to the card's edge a pulled page snaps back to full width. */
export const PAGE_DOCK_DISTANCE_PX = 24;

export function clampPageWidthEm(widthEm: number): number {
  return Math.max(PAGE_WIDTH_MIN_EM, Math.round(widthEm * 10) / 10);
}

/** The width for a page pulled to `widthPx` in a card `availablePx` wide; null when it docks. */
export function draggedPageWidth(widthPx: number, availablePx: number, fontSizePx: number): number | null {
  if (widthPx >= availablePx - PAGE_DOCK_DISTANCE_PX || fontSizePx <= 0) {
    return null;
  }

  return clampPageWidthEm(widthPx / fontSizePx);
}

/** One arrow-key step wider (+1) or narrower (-1) from the width the page has now. */
export function steppedPageWidth(
  currentEm: number | null,
  direction: 1 | -1,
  availablePx: number,
  fontSizePx: number
): number | null {
  const shownEm = Math.min(currentEm ?? Number.POSITIVE_INFINITY, availablePx / fontSizePx);

  return draggedPageWidth((shownEm + direction * PAGE_WIDTH_STEP_EM) * fontSizePx, availablePx, fontSizePx);
}

/** A stored width back from localStorage; anything unreadable is the docked page. */
export function parseStoredPageWidth(raw: string | null): number | null {
  const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);

  return Number.isFinite(parsed) ? clampPageWidthEm(parsed) : null;
}
