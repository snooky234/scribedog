import { describe, expect, it } from "vitest";

import { parseCssColor } from "./oklab";
import { findPresetTheme, PRESET_THEMES } from "./presets";
import { resolveTheme, toThemeDocument, validateTheme } from "./themeFormat";

// Every shipped template has to stay readable, whatever later tuning of the
// derivation does to it. The checks run on the resolved values, i.e. on what
// the app actually paints, with the WCAG contrast ratio.

function luminance(value: string): number {
  const color = parseCssColor(value);
  if (!color) {
    throw new Error(`Unparseable: ${value}`);
  }
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("preset themes", () => {
  it("have unique ids and pass the import validator", () => {
    expect(new Set(PRESET_THEMES.map((preset) => preset.id)).size).toBe(PRESET_THEMES.length);
    for (const preset of PRESET_THEMES) {
      expect(validateTheme(toThemeDocument(preset)), preset.id).toEqual({ ok: true, theme: preset });
    }
  });

  it("are found by id", () => {
    expect(findPresetTheme("sepia")?.mode).toBe("light");
    expect(findPresetTheme("nope")).toBeNull();
  });

  for (const preset of PRESET_THEMES) {
    describe(preset.id, () => {
      const resolved = resolveTheme(preset);
      const surface = resolved.root["--surface-rgb"];

      it("keeps body text and the document text at AAA contrast on the surface", () => {
        expect(contrast(resolved.root["--text-rgb"], surface)).toBeGreaterThanOrEqual(7);
        expect(contrast(resolved.prose["--tw-prose-body"], surface)).toBeGreaterThanOrEqual(7);
        expect(contrast(resolved.prose["--tw-prose-headings"], surface)).toBeGreaterThanOrEqual(7);
      });

      it("keeps muted text at AA contrast on the surface and the raised panels", () => {
        expect(contrast(resolved.root["--muted-rgb"], surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(resolved.root["--muted-rgb"], resolved.root["--surface-raised-rgb"])).toBeGreaterThanOrEqual(4.5);
      });

      it("keeps the links at AA contrast on the surface", () => {
        expect(contrast(resolved.root["--link-rgb"], surface)).toBeGreaterThanOrEqual(4.5);
      });

      it("keeps the text on the accent buttons readable", () => {
        // The AI buttons: near-white text on the accent (large, bold UI text).
        expect(contrast(resolved.root["--on-accent-rgb"], resolved.root["--accent-rgb"])).toBeGreaterThanOrEqual(3);
      });

      it("keeps the paper sheet and the Zen page readable", () => {
        if (resolved.paper) {
          expect(
            contrast(resolved.paper.prose["--tw-prose-body"], resolved.paper.palette["--surface-rgb"])
          ).toBeGreaterThanOrEqual(7);
        }
        if (resolved.zen) {
          expect(contrast(resolved.zen.prose["--tw-prose-body"], resolved.zen.background)).toBeGreaterThanOrEqual(7);
          expect(contrast(resolved.zen.palette["--muted-rgb"], resolved.zen.background)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("keeps hover and active distinguishable from the surface", () => {
        expect(contrast(resolved.root["--surface-hover-rgb"], surface)).toBeGreaterThan(1.05);
        expect(contrast(resolved.root["--surface-active-rgb"], surface)).toBeGreaterThan(1.1);
      });
    });
  }
});
