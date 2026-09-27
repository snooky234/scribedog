import { describe, expect, it } from "vitest";

import type { ShortcutBinding } from "@/lib/shortcuts/binding";
import { findConflict, isCustomBinding, isRetiredDefault, matchShortcut, resolveBinding } from "@/lib/shortcuts/resolve";

// "Show page breaks" ships without a combo; the user can give it one.
const CTRL_ALT_P: ShortcutBinding = { ctrl: true, alt: true, shift: false, code: "KeyP", key: "p", label: "P" };

function keydown(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: "", key: "", ...init } as KeyboardEvent;
}

describe("an action without a default combo", () => {
  it("has no binding until the user assigns one", () => {
    expect(resolveBinding({}, "togglePageLines")).toBeNull();
    expect(resolveBinding({ togglePageLines: CTRL_ALT_P }, "togglePageLines")).toEqual(CTRL_ALT_P);
  });

  it("counts an assigned combo as custom", () => {
    expect(isCustomBinding({}, "togglePageLines")).toBe(false);
    expect(isCustomBinding({ togglePageLines: CTRL_ALT_P }, "togglePageLines")).toBe(true);
  });

  it("fires on its assigned combo only", () => {
    const event = keydown({ ctrlKey: true, altKey: true, code: "KeyP", key: "p" });

    expect(matchShortcut({}, event, "global")).toBeNull();
    expect(matchShortcut({ togglePageLines: CTRL_ALT_P }, event, "global")).toBe("togglePageLines");
  });

  it("neither conflicts nor leaves a retired default behind", () => {
    expect(findConflict({}, "printFile", CTRL_ALT_P)).toBeNull();
    expect(findConflict({ togglePageLines: CTRL_ALT_P }, "printFile", CTRL_ALT_P)).toBe("togglePageLines");
    expect(isRetiredDefault({ togglePageLines: CTRL_ALT_P }, keydown({ ctrlKey: true, code: "KeyZ", key: "z" }), "global")).toBe(
      false
    );
  });
});

describe("insertPageBreak", () => {
  it("takes Ctrl+Enter, also from the numeric keypad", () => {
    expect(matchShortcut({}, keydown({ ctrlKey: true, code: "Enter", key: "Enter" }), "editor")).toBe("insertPageBreak");
    expect(matchShortcut({}, keydown({ ctrlKey: true, code: "NumpadEnter", key: "Enter" }), "editor")).toBe(
      "insertPageBreak"
    );
  });

  it("leaves Shift+Enter, the hard line break, alone", () => {
    expect(matchShortcut({}, keydown({ shiftKey: true, code: "Enter", key: "Enter" }), "editor")).toBeNull();
  });
});
