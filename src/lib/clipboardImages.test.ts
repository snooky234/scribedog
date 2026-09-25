import { beforeEach, describe, expect, it } from "vitest";

import {
  adoptPastedImageSource,
  getProtectedClipboardImages,
  holdClipboardImages,
  rebaseImageSource
} from "@/lib/clipboardImages";

const VAULT = "C:/vault";

beforeEach(() => {
  holdClipboardImages(null, []);
});

describe("rebaseImageSource", () => {
  it("climbs out of the subfolder the target note sits in", () => {
    expect(rebaseImageSource("images/a.png", "C:/vault/a.md", "C:/vault/sub/c.md", VAULT)).toBe("../images/a.png");
  });

  it("drops the climb when the target note sits at the root", () => {
    expect(rebaseImageSource("../../images/a.png", "C:/vault/x/y/a.md", "C:/vault/b.md", VAULT)).toBe(
      "images/a.png"
    );
  });

  it("keeps the reference as written between notes of one folder", () => {
    expect(rebaseImageSource("./images/a.png", "C:/vault/a.md", "C:/vault/b.md", VAULT)).toBe("./images/a.png");
  });

  it("handles backslash paths and folder names in another case", () => {
    expect(rebaseImageSource("..\\images\\a.png", "C:\\vault\\Sub\\a.md", "C:/vault/sub/b.md", VAULT)).toBe(
      "..\\images\\a.png"
    );
    expect(rebaseImageSource("..\\images\\a.png", "C:\\vault\\sub\\a.md", "C:/vault/b.md", VAULT)).toBe(
      "images/a.png"
    );
  });

  it("leaves absolute references and ones that leave the vault alone", () => {
    expect(rebaseImageSource("https://x.org/a.png", "C:/vault/a.md", "C:/vault/sub/c.md", VAULT)).toBe(
      "https://x.org/a.png"
    );
    expect(rebaseImageSource("../images/a.png", "C:/vault/a.md", "C:/vault/sub/c.md", VAULT)).toBe(
      "../images/a.png"
    );
  });
});

describe("adoptPastedImageSource", () => {
  it("rewrites a clipboard image for the note it is pasted into and ends its protection", () => {
    holdClipboardImages("C:/vault/a.md", ["images/a.png"]);

    expect(adoptPastedImageSource("images/a.png", "C:/vault/sub/c.md", VAULT)).toBe("../images/a.png");
    expect(getProtectedClipboardImages()).toBeNull();
  });

  it("still rewrites a second paste of the same clipboard", () => {
    holdClipboardImages("C:/vault/a.md", ["images/a.png"]);
    adoptPastedImageSource("images/a.png", "C:/vault/b.md", VAULT);

    expect(adoptPastedImageSource("images/a.png", "C:/vault/sub/c.md", VAULT)).toBe("../images/a.png");
  });

  it("leaves images that did not come from the clipboard alone", () => {
    holdClipboardImages("C:/vault/a.md", ["images/a.png"]);

    expect(adoptPastedImageSource("images/b.png", "C:/vault/sub/c.md", VAULT)).toBe("images/b.png");
    expect(getProtectedClipboardImages()).not.toBeNull();
  });
});
