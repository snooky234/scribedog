import { describe, expect, it } from "vitest";

import { findFixedConflict, matchFixedEditorShortcut } from "./fixed";

type KeyInit = Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "code" | "key">>;

const keydown = (init: KeyInit) =>
  ({
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    code: "",
    key: "",
    ...init
  }) as KeyboardEvent;

describe("matchFixedEditorShortcut", () => {
  it("tells the three copy combos apart by their modifiers", () => {
    expect(matchFixedEditorShortcut(keydown({ ctrlKey: true, code: "KeyC", key: "c" }))).toBe("copyFormatted");
    expect(matchFixedEditorShortcut(keydown({ ctrlKey: true, altKey: true, code: "KeyC", key: "c" }))).toBe(
      "copyMarkdown"
    );
    expect(matchFixedEditorShortcut(keydown({ ctrlKey: true, shiftKey: true, code: "KeyC", key: "C" }))).toBe(
      "copyPlainText"
    );
  });

  it("tells the two explicit paste combos apart", () => {
    expect(matchFixedEditorShortcut(keydown({ ctrlKey: true, shiftKey: true, code: "KeyV", key: "V" }))).toBe(
      "pastePlainText"
    );
    expect(matchFixedEditorShortcut(keydown({ ctrlKey: true, altKey: true, code: "KeyV", key: "v" }))).toBe(
      "pasteMarkdown"
    );
  });

  it("treats Cmd like Ctrl", () => {
    expect(matchFixedEditorShortcut(keydown({ metaKey: true, altKey: true, code: "KeyC", key: "ç" }))).toBe(
      "copyMarkdown"
    );
  });

  it("ignores everything else", () => {
    expect(matchFixedEditorShortcut(keydown({ ctrlKey: true, code: "KeyV", key: "v" }))).toBeNull();
    expect(matchFixedEditorShortcut(keydown({ altKey: true, code: "KeyC", key: "c" }))).toBeNull();
    expect(matchFixedEditorShortcut(keydown({ ctrlKey: true, altKey: true, shiftKey: true, code: "KeyC" }))).toBeNull();
  });
});

describe("findFixedConflict", () => {
  it("refuses a binding on a copy combo", () => {
    expect(
      findFixedConflict({ ctrl: true, alt: true, shift: false, code: "KeyC", key: "c", label: "C" })?.id
    ).toBe("copyMarkdown");
  });

  it("refuses a binding on the Markdown paste combo", () => {
    expect(
      findFixedConflict({ ctrl: true, alt: true, shift: false, code: "KeyV", key: "v", label: "V" })?.id
    ).toBe("pasteMarkdown");
  });

  it("lets other bindings through", () => {
    expect(findFixedConflict({ ctrl: true, alt: false, shift: false, code: "KeyB", key: "b", label: "B" })).toBeNull();
  });
});
