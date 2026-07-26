import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { APP_FONTS, APP_FONT_IDS } from "@/lib/fonts";
import { PDF_EMBEDDABLE_FONTS } from "./pdfFonts";

// Guards the invariant behind the font catalog: pdfmake embeds a *subset* of
// the face, and its engine (fontkit) can only subset static WOFF1 files —
// WOFF2 and variable fonts parse fine but throw on encode. A family that fails
// here would look correct in the editor and silently fall back to Roboto in
// the PDF, which is exactly the mismatch the closed catalog exists to prevent.

// Vitest resolves Vite's `?url` imports to a path into node_modules; strip the
// dev-server prefix and query so the bytes can be read straight off disk.
function toFilePath(assetUrl: string): string {
  const withoutQuery = assetUrl.split("?")[0];
  return withoutQuery.replace(/^\/@fs\//, "").replace(/^\//, "");
}

describe("export font catalog", () => {
  it("offers an embeddable face for every catalog font except the system default", () => {
    const embeddableIds = Object.keys(PDF_EMBEDDABLE_FONTS).sort();
    const expectedIds = APP_FONT_IDS.filter((id) => id !== "system").sort();

    expect(embeddableIds).toEqual([...expectedIds]);
  });

  for (const fontId of APP_FONT_IDS) {
    const styles = PDF_EMBEDDABLE_FONTS[fontId];

    if (!styles) {
      continue;
    }

    for (const [styleName, assetUrl] of Object.entries(styles)) {
      it(`subsets ${APP_FONTS[fontId].familyName} ${styleName}`, async () => {
        const { create } = await import("fontkit");

        const font = create(readFileSync(toFilePath(assetUrl)));
        const { glyphs } = font.layout("Manuskript — Kapitel 1 ÄÖÜß");
        const subset = font.createSubset();

        for (const glyph of glyphs) {
          subset.includeGlyph(glyph.id);
        }

        expect(subset.encode().length).toBeGreaterThan(100);
      });
    }
  }
});
