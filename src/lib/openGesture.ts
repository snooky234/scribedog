/**
 * Which gesture opens a note from the sidebar (the file tree and the
 * "In progress" list). By default a click opens it and so does every arrow
 * key step; with "open on double-click" a click or an arrow key only marks
 * the row, and double-click or Enter opens. That keeps a note off the screen
 * while someone points at it in the tree, in a presentation for instance.
 *
 * A touch screen ignores the setting: a double tap is unreliable there and
 * zooms the page in some browsers, and nobody browses a tree by tapping
 * rows they do not want to see.
 */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

export function singleClickOpens(openOnDoubleClick: boolean, coarsePointer: boolean): boolean {
  return !openOnDoubleClick || coarsePointer;
}

/** Read at the moment of the gesture: a tablet can gain a mouse mid-session. */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}
