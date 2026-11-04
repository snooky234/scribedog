import { afterEach, describe, expect, it } from "vitest";

import { registerPdfFont } from "@/lib/export/pdfFonts";
import {
  APP_FONTS,
  fillStyleFallbacks,
  getFontDefinition,
  getReferencedFontName,
  isCustomFontId,
  resolveFontId,
  setCustomFonts,
  type CustomFontDefinition,
  type FontStyleName
} from "@/lib/fonts";
import { getPrintFont } from "@/lib/export/printLayout";

function customFont(styles: FontStyleName[], overrides: Partial<CustomFontDefinition> = {}): CustomFontDefinition {
  return {
    id: "custom:test-font",
    label: "Test Font",
    category: "mono",
    familyName: "Test Font",
    cssStack: '"Test Font", monospace',
    pdfLineHeight: 1.3,
    loadStyles: null,
    revision: "r1",
    hasIcons: false,
    iconRanges: [],
    styles: Object.fromEntries(styles.map((style) => [style, true])),
    readStyle: async (style) => new TextEncoder().encode(`bytes of ${style}`),
    ...overrides
  };
}

// pdfmake keeps registered faces for the whole session (and so does
// registerPdfFont), so every test registers under a revision of its own.
afterEach(() => setCustomFonts([]));

describe("custom font ids", () => {
  it("accepts only the shape the import writes", () => {
    expect(isCustomFontId("custom:fira-code")).toBe(true);
    expect(isCustomFontId("custom:")).toBe(false);
    expect(isCustomFontId("custom:../x")).toBe(false);
    expect(isCustomFontId("custom:UPPER")).toBe(false);
    expect(isCustomFontId("lato")).toBe(false);
  });

  it("keeps a stored custom choice while its font is not known", () => {
    expect(resolveFontId("custom:fira-code")).toBe("custom:fira-code");
    expect(resolveFontId("custom:../x")).toBe("system");
    expect(resolveFontId("nonsense")).toBe("system");
    expect(resolveFontId("lato")).toBe("lato");
  });
});

describe("getFontDefinition", () => {
  it("resolves a custom font of the open vault", () => {
    const font = customFont(["normal"]);
    setCustomFonts([font]);

    expect(getFontDefinition("custom:test-font")).toBe(font);
    expect(getReferencedFontName("custom:test-font")).toBe("Test Font");
  });

  it("falls back to the system font when the vault does not have it", () => {
    expect(getFontDefinition("custom:test-font")).toBe(APP_FONTS.system);
    expect(getReferencedFontName("custom:test-font")).toBe("Arial");
    expect(getPrintFont("custom:test-font").cssStack).toContain("Roboto");
  });

  it("prints a custom font with its own stack and line height", () => {
    setCustomFonts([customFont(["normal"])]);

    expect(getPrintFont("custom:test-font")).toMatchObject({ cssStack: '"Test Font", monospace', lineHeight: 1.3, boldWeight: 700 });
  });
});

describe("fillStyleFallbacks", () => {
  it("lets bold, italic and bold italic reuse what exists", () => {
    expect(fillStyleFallbacks({ normal: true })).toEqual({
      normal: "normal",
      bold: "normal",
      italics: "normal",
      bolditalics: "normal"
    });
    expect(fillStyleFallbacks({ normal: true, bold: true })).toMatchObject({ bolditalics: "bold" });
    expect(fillStyleFallbacks({ normal: true, italics: true })).toMatchObject({ bold: "normal", bolditalics: "italics" });
    expect(fillStyleFallbacks({ normal: true, bold: true, italics: true, bolditalics: true }).bolditalics).toBe("bolditalics");
  });
});

describe("registerPdfFont with a custom font", () => {
  function registrar() {
    const calls = { vfs: {} as Record<string, string>, fonts: {} as Record<string, Record<string, string>> };

    return {
      calls,
      pdfMake: {
        addVirtualFileSystem: (vfs: Record<string, string>) => Object.assign(calls.vfs, vfs),
        addFonts: (fonts: Record<string, unknown>) => Object.assign(calls.fonts, fonts)
      }
    };
  }

  it("embeds the user's files, once per distinct file", async () => {
    setCustomFonts([customFont(["normal", "bold"], { revision: "embed" })]);
    const { calls, pdfMake } = registrar();

    const name = await registerPdfFont(pdfMake, "custom:test-font");
    const files = calls.fonts[name];

    expect(name).toBe("custom:test-font@embed");
    expect(Object.keys(calls.vfs)).toHaveLength(2);
    expect(files.normal).toBe(files.italics);
    expect(files.bold).toBe(files.bolditalics);
    expect(files.normal).not.toBe(files.bold);
    expect(atob(calls.vfs[files.bold])).toBe("bytes of bold");
  });

  it("registers a replaced font again under its new revision", async () => {
    const { calls, pdfMake } = registrar();

    setCustomFonts([customFont(["normal"], { revision: "swap-1" })]);
    await registerPdfFont(pdfMake, "custom:test-font");
    setCustomFonts([customFont(["normal"], { revision: "swap-2" })]);
    const name = await registerPdfFont(pdfMake, "custom:test-font");

    expect(name).toBe("custom:test-font@swap-2");
    expect(Object.keys(calls.fonts)).toHaveLength(2);
  });

  it("falls back to Roboto when the files cannot be read", async () => {
    setCustomFonts([
      customFont(["normal"], {
        revision: "broken",
        readStyle: async () => {
          throw new Error("gone");
        }
      })
    ]);

    expect(await registerPdfFont(registrar().pdfMake, "custom:test-font")).toBe("Roboto");
  });

  it("falls back to Roboto for a font the vault does not have", async () => {
    expect(await registerPdfFont(registrar().pdfMake, "custom:missing")).toBe("Roboto");
  });
});
