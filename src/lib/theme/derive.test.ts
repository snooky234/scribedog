import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ADVANCED_COLOR_KEYS,
  advancedTokenNames,
  DEFAULT_ADVANCED_COLORS,
  DEFAULT_BASE_COLORS,
  DEFAULT_PAPER_COLORS,
  derivePaperVariables,
  deriveProseVariables,
  builtInProseReference,
  deriveThemeVariables,
  type ThemeMode
} from "./derive";
import { parseCssColor, rgbToOklab } from "./oklab";

// The built-in palettes in tokens.css are the fixtures: deriving from the
// default base colours has to land on them, so a custom theme resolved with
// the same rules sits exactly where the built-in one does, and a token added
// to tokens.css without a rule here fails the coverage check below.

function declarations(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) {
    throw new Error(`Block not found: ${selector}`);
  }
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const result: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    result[match[1]] = match[2].trim();
  }
  return result;
}

// A Windows checkout with core.autocrlf has CRLF; the selectors below are LF.
const css = readFileSync("src/styles/tokens.css", "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const rootOnly = declarations(css, ":root");
const lightPalette = declarations(css, ":root,\n.dark .editor-view__surface--paper");
const darkPalette = declarations(css, ".dark");

const builtIn: Record<ThemeMode, Record<string, string>> = {
  light: { ...rootOnly, ...lightPalette },
  dark: { ...rootOnly, ...lightPalette, ...darkPalette }
};

/** Tokens in tokens.css that are not part of a theme. */
const NOT_THEMED = new Set([
  "--radius",
  "--on-dark-rgb",
  "--on-image-bg-rgb",
  "--on-image-fg-rgb",
  "--on-image-edge-rgb"
]);

const SHADCN = new Set([
  "--background",
  "--foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--accent",
  "--accent-foreground",
  "--border",
  "--input",
  "--ring"
]);

function maxChannelDelta(a: string, b: string): number {
  const ca = parseCssColor(a);
  const cb = parseCssColor(b);
  if (!ca || !cb) {
    throw new Error(`Unparseable: ${a} / ${b}`);
  }
  return Math.max(Math.abs(ca.r - cb.r), Math.abs(ca.g - cb.g), Math.abs(ca.b - cb.b));
}

for (const mode of ["light", "dark"] as const) {
  describe(`deriveThemeVariables from the default ${mode} base colours`, () => {
    const derived = deriveThemeVariables(mode, DEFAULT_BASE_COLORS[mode]);
    const expected = builtIn[mode];

    it("covers every themed token in tokens.css", () => {
      const missing = Object.keys(expected).filter(
        (name) => !NOT_THEMED.has(name) && !(name in derived)
      );
      expect(missing).toEqual([]);
    });

    it("produces no token tokens.css does not have", () => {
      expect(Object.keys(derived).filter((name) => !(name in expected))).toEqual([]);
    });

    it("reproduces the derived colours within one step per channel", () => {
      for (const [name, value] of Object.entries(derived)) {
        if (SHADCN.has(name) || (name.startsWith("--accent-") && name.endsWith("-rgb")) || !name.match(/rgb$|^--body-bg/)) {
          continue;
        }
        expect(maxChannelDelta(value, expected[name]), name).toBeLessThanOrEqual(1);
      }
    });

    // Looser than the rest: tokens.css holds Tailwind's violet ramp as the
    // pre-bundle fallback, while the running app has always shown the ramp
    // buildAccentPalette computes (useAccentColorStore applies it at startup).
    it("stays close to the accent ramp of the default accent", () => {
      for (const name of Object.keys(derived).filter((key) => key.startsWith("--accent-") && key.endsWith("-rgb"))) {
        expect(maxChannelDelta(derived[name], expected[name]), name).toBeLessThanOrEqual(6);
      }
    });

    it("keeps the shadcn tokens at the built-in lightness and alpha", () => {
      for (const name of SHADCN) {
        const actual = parseCssColor(derived[name]);
        const reference = parseCssColor(expected[name]);
        if (!actual || !reference) {
          throw new Error(name);
        }
        const actualLab = rgbToOklab(actual);
        const referenceLab = rgbToOklab(reference);
        // Lightness is the step; the hue is the base colour's (the built-in
        // grays are neutral, the slate/near-neutral bases are close to it).
        expect(Math.abs(actualLab.l - referenceLab.l), name).toBeLessThan(0.005);
        expect(Math.hypot(actualLab.a - referenceLab.a, actualLab.b - referenceLab.b), name).toBeLessThan(0.05);
        expect(actual.alpha, name).toBeCloseTo(reference.alpha, 5);
      }
    });

    it("carries the mode's own palette over verbatim", () => {
      for (const [name, value] of Object.entries(derived)) {
        if (name.endsWith("-rgb") || name.startsWith("--body-bg") || SHADCN.has(name)) {
          continue;
        }
        expect(value, name).toBe(expected[name]);
      }
    });
  });
}

describe("deriveThemeVariables for custom base colours", () => {
  const warmDark = {
    background: "#1b1612",
    surface: "#241d18",
    text: "#f1e6d8",
    muted: "#b8a58f",
    chrome: "#a8906f",
    accent: "#e07b39"
  };

  function lightness(triplet: string): number {
    const color = parseCssColor(triplet);
    if (!color) {
      throw new Error(triplet);
    }
    return rgbToOklab(color).l;
  }

  it("keeps hover and active above the surface in dark mode", () => {
    const vars = deriveThemeVariables("dark", warmDark);
    const surface = lightness(vars["--surface-rgb"]);

    expect(lightness(vars["--surface-hover-rgb"])).toBeGreaterThan(surface);
    expect(lightness(vars["--surface-active-rgb"])).toBeGreaterThan(lightness(vars["--surface-hover-rgb"]));
  });

  it("keeps hover and active below the surface in light mode", () => {
    const vars = deriveThemeVariables("light", { ...DEFAULT_BASE_COLORS.light, surface: "#fbf6ee" });
    const surface = lightness(vars["--surface-rgb"]);

    expect(lightness(vars["--surface-hover-rgb"])).toBeLessThan(surface);
    expect(lightness(vars["--surface-active-rgb"])).toBeLessThan(lightness(vars["--surface-hover-rgb"]));
  });

  it("passes the base colours through unchanged", () => {
    const vars = deriveThemeVariables("dark", warmDark);

    expect(vars["--surface-rgb"]).toBe("36, 29, 24");
    expect(vars["--text-rgb"]).toBe("241, 230, 216");
    expect(vars["--body-bg-start"]).toBe("#1b1612");
    expect(vars["--accent-rgb"]).toBe("224, 123, 57");
  });

  it("emits only values that parse as colours or numbers", () => {
    for (const [name, value] of Object.entries(deriveThemeVariables("dark", warmDark))) {
      expect(parseCssColor(value) !== null || /^[\d.]+$/.test(value) || value.startsWith("oklch("), name).toBe(true);
    }
  });
});

describe("advanced colours", () => {
  for (const mode of ["light", "dark"] as const) {
    it(`reproduce the built-in ${mode} values when set to their defaults`, () => {
      const plain = deriveThemeVariables(mode, DEFAULT_BASE_COLORS[mode]);
      const explicit = deriveThemeVariables(mode, DEFAULT_BASE_COLORS[mode], DEFAULT_ADVANCED_COLORS[mode]);

      for (const key of ADVANCED_COLOR_KEYS) {
        for (const name of advancedTokenNames(key)) {
          expect(name in plain, name).toBe(true);
          expect(maxChannelDelta(explicit[name], plain[name]), `${key} ${name}`).toBeLessThanOrEqual(2);
          expect(parseCssColor(explicit[name])?.alpha, name).toBeCloseTo(parseCssColor(plain[name])?.alpha ?? 1, 3);
        }
      }
    });
  }

  it("leaves the mode's values alone for colours that are not set", () => {
    const vars = deriveThemeVariables("dark", DEFAULT_BASE_COLORS.dark, { error: "#ff00aa" });

    expect(vars["--error-rgb"]).toBe("255, 0, 170");
    expect(vars["--success-fg"]).toBe("#bbf7d0");
    expect(vars["--code-keyword"]).toBe("#b3a2f7");
  });

  it("follows a changed status colour in its text and panel tones", () => {
    const vars = deriveThemeVariables("dark", DEFAULT_BASE_COLORS.dark, { error: "#3b82f6" });
    const fg = parseCssColor(vars["--error-fg"]);

    // A blue "error" gets a pale blue message text, not the pale red one.
    expect(fg && fg.b > fg.r).toBe(true);
  });
});

describe("derivePaperVariables", () => {
  it("reproduces the light palette from the default sheet colours", () => {
    const paper = derivePaperVariables(DEFAULT_PAPER_COLORS);
    const light = deriveThemeVariables("light", DEFAULT_BASE_COLORS.light);

    expect(paper["--surface-rgb"]).toBe(light["--surface-rgb"]);
    expect(paper["--surface-hover-rgb"]).toBe(light["--surface-hover-rgb"]);
    expect(paper["--text-rgb"]).toBe(light["--text-rgb"]);
  });

  it("does not redeclare the tokens the paper inherits from the dark UI", () => {
    const paper = derivePaperVariables(DEFAULT_PAPER_COLORS);

    expect("--shadow-rgb" in paper).toBe(false);
    expect("--accent-rgb" in paper).toBe(false);
  });

  it("builds the sheet's hover rows from its own background", () => {
    const paper = derivePaperVariables({ background: "#f4ecd8", text: "#3b2f20" });

    expect(paper["--surface-rgb"]).toBe("244, 236, 216");
    expect(paper["--surface-hover-rgb"]).not.toBe("228, 233, 240");
  });
});

describe("deriveProseVariables", () => {
  for (const mode of ["light", "dark"] as const) {
    it(`lands on Typography's ${mode} gray scale from the default base colours`, () => {
      const derived = deriveProseVariables(mode, DEFAULT_BASE_COLORS[mode]);
      const reference = builtInProseReference(mode);

      for (const [name, value] of Object.entries(reference)) {
        const actual = parseCssColor(derived[name]);
        const expected = parseCssColor(value);
        if (!actual || !expected) {
          throw new Error(name);
        }
        const actualLab = rgbToOklab(actual);
        const expectedLab = rgbToOklab(expected);
        expect(Math.abs(actualLab.l - expectedLab.l), name).toBeLessThan(0.01);
        expect(Math.hypot(actualLab.a - expectedLab.a, actualLab.b - expectedLab.b), name).toBeLessThan(0.05);
        expect(actual.alpha, name).toBeCloseTo(expected.alpha, 3);
      }
    });
  }
});
