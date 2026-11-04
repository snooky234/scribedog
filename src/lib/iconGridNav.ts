// Where an arrow key moves the focus in the icon picker's grid. Pure, so the
// edges (first row, last, a short last row) are tested without a DOM.

/**
 * The index a key moves to from `index` in a grid of `count` cells, `columns`
 * wide; "leave-up" for arrow up out of the first row, null for a key that is
 * not navigation.
 */
export function nextGridIndex(
  key: string,
  ctrl: boolean,
  index: number,
  count: number,
  columns: number,
  pageRows: number
): number | "leave-up" | null {
  if (count === 0) {
    return null;
  }

  const last = count - 1;
  const clamp = (value: number) => Math.min(last, Math.max(0, value));
  const rowStart = index - (index % columns);

  switch (key) {
    case "ArrowLeft":
      return clamp(index - 1);
    case "ArrowRight":
      return clamp(index + 1);
    case "ArrowUp":
      return index < columns ? "leave-up" : index - columns;
    case "ArrowDown":
      // Into a short last row it lands on its last cell instead of doing nothing.
      return index + columns <= last ? index + columns : Math.floor(last / columns) > Math.floor(index / columns) ? last : index;
    case "PageUp":
      return clamp(index - pageRows * columns);
    case "PageDown":
      return clamp(index + pageRows * columns);
    case "Home":
      return ctrl ? 0 : rowStart;
    case "End":
      return ctrl ? last : Math.min(last, rowStart + columns - 1);
    default:
      return null;
  }
}
