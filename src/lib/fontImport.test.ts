import { describe, expect, it } from "vitest";

import type { FontInspection } from "./fontFile";
import {
  clampIconScale,
  createManifest,
  ICON_SCALE_MAX,
  ICON_SCALE_MIN,
  fontIdForName,
  groupIntoFamilies,
  normalizeManifest,
  sanitizeFontName,
  slugifyFontName,
  type InspectedFontFile
} from "./fontImport";

function file(fileName: string, overrides: Partial<FontInspection> = {}): InspectedFontFile {
  return {
    fileName,
    bytes: new Uint8Array(),
    font: {
      familyName: "Test Font",
      subfamilyName: "Regular",
      weight: 400,
      italic: false,
      pdfLineHeight: 1.2,
      monospace: false,
      serif: false,
      codepointRanges: [[0x41, 0x5a]],
      hasIcons: false,
      privateUseRanges: [],
      container: "sfnt",
      ...overrides
    }
  };
}

describe("slugifyFontName", () => {
  it("makes a folder-safe name", () => {
    expect(slugifyFontName("0xProto Nerd Font")).toBe("0xproto-nerd-font");
    expect(slugifyFontName("  Crème  Brûlée! ")).toBe("creme-brulee");
    expect(slugifyFontName("../../etc")).toBe("etc");
    expect(slugifyFontName("日本語")).toBe("font");
    expect(fontIdForName("Fira Code")).toBe("custom:fira-code");
  });
});

describe("sanitizeFontName", () => {
  it("drops what would break out of a stylesheet or an XML attribute", () => {
    expect(sanitizeFontName('Evil"; } body { x: <y>')).toBe("Evil body x y");
    expect(sanitizeFontName("  Lato   Light ")).toBe("Lato Light");
  });
});

describe("groupIntoFamilies", () => {
  it("assigns the four styles of one family", () => {
    const [family] = groupIntoFamilies([
      file("a-bold-italic.ttf", { weight: 700, italic: true }),
      file("a-regular.ttf"),
      file("a-italic.ttf", { italic: true }),
      file("a-bold.ttf", { weight: 700 })
    ]);

    expect(family.id).toBe("custom:test-font");
    expect(Object.keys(family.files).sort()).toEqual(["bold", "bolditalics", "italics", "normal"]);
    expect(family.files.bolditalics?.fileName).toBe("a-bold-italic.ttf");
  });

  it("splits files of different families, as in a Nerd Font download", () => {
    const families = groupIntoFamilies([
      file("regular.ttf", { familyName: "Proto Nerd Font" }),
      file("mono.ttf", { familyName: "Proto Nerd Font Mono", monospace: true }),
      file("mono-bold.ttf", { familyName: "Proto Nerd Font Mono", weight: 700, monospace: true })
    ]);

    expect(families.map((family) => family.name)).toEqual(["Proto Nerd Font", "Proto Nerd Font Mono"]);
    expect(families[1].category).toBe("mono");
    expect(Object.keys(families[1].files).sort()).toEqual(["bold", "normal"]);
  });

  it("takes the weights closest to regular and bold and ignores the rest", () => {
    const [family] = groupIntoFamilies([
      file("light.ttf", { weight: 300 }),
      file("regular.ttf", { weight: 400 }),
      file("medium.ttf", { weight: 500 }),
      file("bold.ttf", { weight: 700 }),
      file("black.ttf", { weight: 900 })
    ]);

    expect(family.files.normal?.fileName).toBe("regular.ttf");
    expect(family.files.bold?.fileName).toBe("bold.ttf");
  });

  it("promotes the only file it has to regular", () => {
    const [family] = groupIntoFamilies([file("only-bold.ttf", { weight: 700 })]);

    expect(family.files.normal?.fileName).toBe("only-bold.ttf");
    expect(family.files.bold).toBeUndefined();
  });

  it("carries icons, serif and metrics of the regular file", () => {
    const [icons] = groupIntoFamilies([
      file("regular.ttf", { serif: true, pdfLineHeight: 1.31 }),
      file("bold.ttf", { weight: 700, hasIcons: true })
    ]);

    expect(icons).toMatchObject({ category: "serif", pdfLineHeight: 1.31, hasIcons: true });
  });
});

describe("manifest", () => {
  const [family] = groupIntoFamilies([file("r.ttf"), file("b.woff", { weight: 700, container: "woff" })]);

  it("round-trips through normalizeManifest", () => {
    const manifest = createManifest(family, "abc");

    expect(manifest.files).toEqual({ normal: "normal.ttf", bold: "bold.woff" });
    expect(normalizeManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });

  it("rejects anything that is not exactly what the import writes", () => {
    const valid = createManifest(family, "abc");

    expect(normalizeManifest(null)).toBeNull();
    expect(normalizeManifest({ ...valid, name: "" })).toBeNull();
    expect(normalizeManifest({ ...valid, category: "script" })).toBeNull();
    expect(normalizeManifest({ ...valid, pdfLineHeight: 0 })).toBeNull();
    expect(normalizeManifest({ ...valid, files: { bold: "bold.ttf" } })).toBeNull();
    // A file name is joined onto a path, so nothing with a separator gets through.
    expect(normalizeManifest({ ...valid, files: { normal: "../../secret.ttf" } })).toBeNull();
    expect(normalizeManifest({ ...valid, files: { normal: "bold.ttf" } })).toBeNull();
    expect(normalizeManifest({ ...valid, files: { normal: "normal.exe" } })).toBeNull();
  });

  it("cleans the name on the way in", () => {
    expect(normalizeManifest({ ...createManifest(family, "x"), name: 'A"B' })?.name).toBe("AB");
  });

  it("carries the icon size and clamps what a hand-edited manifest says", () => {
    expect(createManifest(family, "x").iconScale).toBe(1);
    expect(normalizeManifest(JSON.parse(JSON.stringify(createManifest(family, "x", 1.35))))?.iconScale).toBe(1.35);

    const valid = createManifest(family, "x");

    expect(normalizeManifest({ ...valid, iconScale: 9 })?.iconScale).toBe(ICON_SCALE_MAX);
    expect(normalizeManifest({ ...valid, iconScale: 0.01 })?.iconScale).toBe(ICON_SCALE_MIN);
    expect(normalizeManifest({ ...valid, iconScale: "big" })?.iconScale).toBe(1);
    expect(normalizeManifest({ ...valid, iconScale: Number.NaN })?.iconScale).toBe(1);
  });

  it("reads a manifest from before the icon size existed as 1", () => {
    const { iconScale: _omitted, ...legacy } = createManifest(family, "x");

    expect(normalizeManifest(legacy)?.iconScale).toBe(1);
  });
});

describe("clampIconScale", () => {
  it("snaps to the slider step and stays inside the bounds", () => {
    expect(clampIconScale(1.07)).toBe(1.05);
    expect(clampIconScale(1.5)).toBe(1.5);
    expect(clampIconScale(100)).toBe(ICON_SCALE_MAX);
    expect(clampIconScale(-3)).toBe(ICON_SCALE_MIN);
    expect(clampIconScale(undefined)).toBe(1);
  });
});
