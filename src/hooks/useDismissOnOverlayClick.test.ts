import { describe, expect, it } from "vitest";

import { isOverlayDismissClick } from "./useDismissOnOverlayClick";

const overlay = {} as EventTarget;
const panel = {} as EventTarget;

describe("isOverlayDismissClick", () => {
  it("dismisses a click that both starts and ends on the backdrop", () => {
    expect(isOverlayDismissClick({ target: overlay, currentTarget: overlay }, true)).toBe(true);
  });

  it("keeps the dialog open when the press started inside the panel", () => {
    // Dragging a text selection out of the dialog and releasing over the
    // backdrop: the click lands on the backdrop, but it is not one.
    expect(isOverlayDismissClick({ target: overlay, currentTarget: overlay }, false)).toBe(false);
  });

  it("ignores a click that bubbled up from the panel", () => {
    expect(isOverlayDismissClick({ target: panel, currentTarget: overlay }, true)).toBe(false);
  });
});
