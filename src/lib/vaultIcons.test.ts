import { describe, expect, it } from "vitest";

import {
  getVaultIcon,
  iconPathKey,
  isGlyphIcon,
  isValidIcon,
  normalizeVaultIcons,
  pruneVaultIcons,
  removeIconPath,
  renameIconPath,
  setVaultIcon,
  type VaultIconMap
} from "./vaultIcons";

describe("iconPathKey", () => {
  it("normalizes separators, case and surrounding slashes", () => {
    expect(iconPathKey("Ideen\\Notizen.md")).toBe("ideen/notizen.md");
    expect(iconPathKey("/Ideen/")).toBe("ideen");
    expect(iconPathKey("")).toBe("");
  });
});

describe("isValidIcon", () => {
  it("accepts emoji, including multi-codepoint sequences", () => {
    expect(isValidIcon("📁")).toBe(true);
    expect(isValidIcon("👩🏽‍🚒")).toBe(true);
  });

  it("rejects empty, whitespace-bearing and oversized values", () => {
    expect(isValidIcon("")).toBe(false);
    expect(isValidIcon("a b")).toBe(false);
    expect(isValidIcon("\n")).toBe(false);
    expect(isValidIcon("x".repeat(33))).toBe(false);
    expect(isValidIcon(42)).toBe(false);
  });
});

describe("normalizeVaultIcons", () => {
  it("keeps valid pairs and drops everything else", () => {
    expect(
      normalizeVaultIcons({
        "Ideen/Notiz.md": "📝",
        "Leer.md": "",
        "Zahl.md": 7,
        "": "📁"
      })
    ).toEqual({ "ideen/notiz.md": "📝" });
  });

  it("survives a file that is not an object", () => {
    expect(normalizeVaultIcons(null)).toEqual({});
    expect(normalizeVaultIcons(["📁"])).toEqual({});
    expect(normalizeVaultIcons("nope")).toEqual({});
  });
});

describe("getVaultIcon / setVaultIcon", () => {
  const icons: VaultIconMap = { "ideen/notiz.md": "📝" };

  it("looks up regardless of separator and case", () => {
    expect(getVaultIcon(icons, "Ideen\\Notiz.md")).toBe("📝");
    expect(getVaultIcon(icons, "Ideen/Fehlt.md")).toBeNull();
  });

  it("sets, replaces and clears", () => {
    expect(setVaultIcon({}, "Notiz.md", "📌")).toEqual({ "notiz.md": "📌" });
    expect(setVaultIcon(icons, "Ideen/Notiz.md", "📌")).toEqual({ "ideen/notiz.md": "📌" });
    expect(setVaultIcon(icons, "Ideen/Notiz.md", null)).toEqual({});
  });

  it("returns the same map when nothing changes, so no write is triggered", () => {
    expect(setVaultIcon(icons, "Ideen/Notiz.md", "📝")).toBe(icons);
    expect(setVaultIcon(icons, "Ideen/Fehlt.md", null)).toBe(icons);
    expect(setVaultIcon(icons, "Ideen/Notiz.md", "kaputt wegen leerzeichen")).toBe(icons);
  });
});

describe("renameIconPath", () => {
  it("carries a file's own icon to the new path", () => {
    expect(renameIconPath({ "alt.md": "📝" }, "alt.md", "neu.md")).toEqual({ "neu.md": "📝" });
  });

  it("carries every icon below a renamed folder", () => {
    const icons: VaultIconMap = {
      "alt": "📁",
      "alt/notiz.md": "📝",
      "alt/tief/weiter.md": "📌",
      "woanders.md": "⭐"
    };

    expect(renameIconPath(icons, "alt", "neu")).toEqual({
      "neu": "📁",
      "neu/notiz.md": "📝",
      "neu/tief/weiter.md": "📌",
      "woanders.md": "⭐"
    });
  });

  it("leaves a folder whose name is only a prefix of the renamed one alone", () => {
    expect(renameIconPath({ "altbau.md": "📝" }, "alt", "neu")).toEqual({ "altbau.md": "📝" });
  });

  it("returns the same map when nothing matched", () => {
    const icons: VaultIconMap = { "notiz.md": "📝" };

    expect(renameIconPath(icons, "fehlt.md", "neu.md")).toBe(icons);
    expect(renameIconPath(icons, "notiz.md", "notiz.md")).toBe(icons);
  });
});

describe("removeIconPath", () => {
  it("drops the entry and its subtree", () => {
    const icons: VaultIconMap = {
      "ordner": "📁",
      "ordner/notiz.md": "📝",
      "ordnerhaft.md": "⭐"
    };

    expect(removeIconPath(icons, "ordner")).toEqual({ "ordnerhaft.md": "⭐" });
  });

  it("returns the same map when there was nothing to drop", () => {
    const icons: VaultIconMap = { "notiz.md": "📝" };

    expect(removeIconPath(icons, "fehlt.md")).toBe(icons);
  });
});

describe("pruneVaultIcons", () => {
  it("drops entries whose path is gone", () => {
    const icons: VaultIconMap = { "da.md": "📝", "weg.md": "📌" };

    expect(pruneVaultIcons(icons, ["Da.md"])).toEqual({ "da.md": "📝" });
  });

  it("returns the same map when every entry still exists", () => {
    const icons: VaultIconMap = { "da.md": "📝" };

    expect(pruneVaultIcons(icons, ["da.md", "andere.md"])).toBe(icons);
  });
});

describe("isGlyphIcon", () => {
  it("tells an icon-font glyph from an emoji", () => {
    expect(isGlyphIcon(String.fromCodePoint(0xf308))).toBe(true);
    expect(isGlyphIcon(String.fromCodePoint(0xf0868))).toBe(true);
    expect(isGlyphIcon("📕")).toBe(false);
    expect(isGlyphIcon("🐶")).toBe(false);
    expect(isGlyphIcon("→")).toBe(false);
  });
});
