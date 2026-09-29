// window.print() blocks the page until the print preview closes, but not the
// native window: a click on its close button meanwhile is queued and reaches
// the close handler only once the preview is gone, where it would close the
// app the user is just returning to, without a word. The preview is modal and
// already ignores that click visibly, so a close request that arrives while
// it is open, or right after it (the queued one), is dropped rather than
// carried out later.

/** How long after the preview closes a close request still counts as queued during it. */
export const QUEUED_CLOSE_GRACE_MS = 1000;

let printing = false;
let printEndedAt = Number.NEGATIVE_INFINITY;

/** Opens the print dialog and remembers when it closed. */
export function runPrintDialog(print: () => void, now: () => number = () => performance.now()): void {
  printing = true;

  try {
    print();
  } finally {
    printing = false;
    printEndedAt = now();
  }
}

/** Whether a close request now was made during the print preview, not after it. */
export function isCloseRequestFromPrintPreview(now: number = performance.now()): boolean {
  return printing || now - printEndedAt < QUEUED_CLOSE_GRACE_MS;
}
