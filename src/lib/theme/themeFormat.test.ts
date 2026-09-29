import { describe, expect, it } from "vitest";

import { DEFAULT_BASE_COLORS } from "./derive";
import {
  createThemeId,
  parseStoredThemes,
  parseThemeJson,
  resolveTheme,
  serializeStoredThemes,
  serializeTheme,
  themeBootInfo,
  themeFileName,
  themeStylesheet,
  toCssDeclarations,
  themesEqual,
  uniqueThemeName,
  validateTheme,
  type CustomTheme
} from "./themeFormat";

const theme: CustomTheme = {
  id: "theme-abc",
  name: "Sepia Nacht",
  mode: "dark",
  base: { ...DEFAULT_BASE_COLORS.dark, surface: "#241d18" },
  paper: { background: "#f4ecd8", text: "#3b2f20" },
  advanced: { marker: "#b45309" }
};

function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...JSON.parse(serializeTheme(theme)), ...overrides };
}

describe("serializeTheme / parseThemeJson", () => {
  it("round-trips a theme", () => {
    const result = parseThemeJson(serializeTheme(theme));

    expect(result).toEqual({ ok: true, theme });
  });

  it("writes the format marker and version first", () => {
    const keys = Object.keys(JSON.parse(serializeTheme(theme)));

    expect(keys.slice(0, 2)).toEqual(["format", "version"]);
  });

  it("leaves out an empty advanced block and a missing paper", () => {
    const plain = JSON.parse(serializeTheme({ ...theme, paper: undefined, advanced: {} }));

    expect("advanced" in plain).toBe(false);
    expect("paper" in plain).toBe(false);
  });

  it("lowercases colours", () => {
    const result = validateTheme(document({ base: { ...theme.base, accent: "#ABCDEF" } }));

    expect(result.ok && result.theme.base.accent).toBe("#abcdef");
  });
});

describe("validateTheme rejects", () => {
  it("broken JSON", () => {
    expect(parseThemeJson("{").ok).toBe(false);
    expect(parseThemeJson("{")).toEqual({ ok: false, error: "invalidJson" });
  });

  it("something that is not a theme", () => {
    expect(validateTheme({ bindings: {} })).toEqual({ ok: false, error: "notATheme" });
    expect(validateTheme([])).toEqual({ ok: false, error: "notATheme" });
  });

  it("a newer format version", () => {
    expect(validateTheme(document({ version: 2 }))).toEqual({ ok: false, error: "unsupportedVersion" });
  });

  it("unknown keys, at the top and inside the colour maps", () => {
    expect(validateTheme(document({ css: "body{}" })).ok).toBe(false);
    expect(validateTheme(document({ base: { ...theme.base, extra: "#000000" } })).ok).toBe(false);
    expect(validateTheme(document({ advanced: { "--error-rgb": "#000000" } })).ok).toBe(false);
  });

  it("anything but #rrggbb as a colour", () => {
    for (const color of ["red", "#fff", "rgb(0,0,0)", "#000000; }", "var(--x)", 0]) {
      expect(validateTheme(document({ base: { ...theme.base, text: color } })).ok, String(color)).toBe(false);
    }
  });

  it("a missing base colour", () => {
    const { accent: _accent, ...withoutAccent } = theme.base;
    expect(validateTheme(document({ base: withoutAccent })).ok).toBe(false);
  });

  it("a bad mode, id or name", () => {
    expect(validateTheme(document({ mode: "sepia" })).ok).toBe(false);
    expect(validateTheme(document({ id: "../x" })).ok).toBe(false);
    expect(validateTheme(document({ name: "" })).ok).toBe(false);
    expect(validateTheme(document({ name: "a".repeat(61) })).ok).toBe(false);
    expect(validateTheme(document({ name: `x${String.fromCharCode(10)}y` })).ok).toBe(false);
    expect(validateTheme(document({ name: `x${String.fromCharCode(0x2028)}y` })).ok).toBe(false);
  });
});

describe("parseStoredThemes", () => {
  it("keeps the valid entries of a partly broken list", () => {
    const raw = JSON.stringify([JSON.parse(serializeTheme(theme)), { format: "x" }, 42]);

    expect(parseStoredThemes(raw)).toEqual([theme]);
  });

  it("drops a second entry with the same id", () => {
    const raw = serializeStoredThemes([theme, { ...theme, name: "Kopie" }]);

    expect(parseStoredThemes(raw)).toHaveLength(1);
  });

  it("survives missing and unreadable storage", () => {
    expect(parseStoredThemes(null)).toEqual([]);
    expect(parseStoredThemes("nope")).toEqual([]);
    expect(parseStoredThemes("{}")).toEqual([]);
  });
});

describe("resolveTheme", () => {
  it("builds the paper palette only for a dark theme", () => {
    expect(resolveTheme(theme).paper?.palette["--surface-rgb"]).toBe("244, 236, 216");
    expect(resolveTheme({ ...theme, mode: "light", base: DEFAULT_BASE_COLORS.light }).paper).toBeNull();
  });

  it("applies the advanced colours", () => {
    expect(resolveTheme(theme).root["--highlight-bg"]).toBe("rgba(180, 83, 9, 0.18)");
  });
});

describe("themeStylesheet", () => {
  it("styles the editor's document colours and, for a dark theme, the paper sheet", () => {
    const css = themeStylesheet(resolveTheme(theme));

    expect(css).toContain(".editor-view__surface.prose {");
    expect(css).toContain("html.dark .editor-view__surface--paper, html.dark .paper-palette { ");
    expect(css).toContain("--surface-rgb: 244, 236, 216;");
    expect(css).toContain("html.dark .editor-view__surface--paper.prose {");
  });

  it("has no paper rules for a light theme", () => {
    const css = themeStylesheet(resolveTheme({ ...theme, mode: "light", base: DEFAULT_BASE_COLORS.light }));

    expect(css).not.toContain("paper");
  });
});

describe("toCssDeclarations", () => {
  it("writes custom properties as declarations", () => {
    expect(toCssDeclarations({ "--a-rgb": "1, 2, 3", "--b": "#ffffff" })).toBe("--a-rgb: 1, 2, 3; --b: #ffffff;");
  });

  it("drops anything that could leave the declaration", () => {
    expect(toCssDeclarations({ "--a": "red; } body { color: red", "b": "#000000", "--c": "#000000" })).toBe(
      "--c: #000000;"
    );
  });
});

describe("helpers", () => {
  it("creates ids the validator accepts", () => {
    expect(validateTheme(document({ id: createThemeId() })).ok).toBe(true);
  });

  it("makes a safe file name", () => {
    expect(themeFileName({ ...theme, name: "Grün & Blau / Test" })).toBe("grun-blau-test.scribedog-theme.json");
    expect(themeFileName({ ...theme, name: "日本" })).toBe("theme.scribedog-theme.json");
  });

  it("gives the boot script the mode and the root background", () => {
    expect(themeBootInfo(theme)).toEqual({ mode: "dark", background: resolveTheme(theme).root["--body-bg-end"] });
  });
});

describe("uniqueThemeName", () => {
  it("keeps a free name and numbers a taken one", () => {
    expect(uniqueThemeName("Sepia", ["Nord"])).toBe("Sepia");
    expect(uniqueThemeName("Sepia", ["sepia"])).toBe("Sepia (2)");
    expect(uniqueThemeName("Sepia", ["Sepia", "Sepia (2)"])).toBe("Sepia (3)");
  });

  it("stays within the name limit", () => {
    const long = "a".repeat(60);
    const result = uniqueThemeName(long, [long]);

    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith(" (2)")).toBe(true);
  });
});

describe("themesEqual", () => {
  it("ignores an empty advanced block", () => {
    expect(themesEqual({ ...theme, advanced: undefined }, { ...theme, advanced: {} })).toBe(true);
    expect(themesEqual(theme, { ...theme, name: "Anders" })).toBe(false);
  });
});

describe("Zen mode colours", () => {
  const withZen: CustomTheme = { ...theme, zen: { background: "#f6f1e4", text: "#3a3024" } };

  it("round-trip and validate like the paper colours", () => {
    expect(parseThemeJson(serializeTheme(withZen))).toEqual({ ok: true, theme: withZen });
    expect(validateTheme(document({ zen: { background: "#000000" } })).ok).toBe(false);
    expect(validateTheme(document({ zen: { background: "#000000", text: "white" } })).ok).toBe(false);
  });

  it("derive in the page's own mode, whatever the theme's", () => {
    const zen = resolveTheme(withZen).zen;

    // A light page in a dark theme.
    expect(zen?.mode).toBe("light");
    expect(zen?.palette["--surface-rgb"]).toBe("246, 241, 228");
    expect(zen?.palette["--text-rgb"]).toBe("58, 48, 36");
    // The theme's accent comes along.
    expect(zen?.palette["--accent-rgb"]).toBe(resolveTheme(withZen).root["--accent-rgb"]);
  });

  it("are absent without a zen block", () => {
    expect(resolveTheme(theme).zen).toBeNull();
    expect(themeStylesheet(resolveTheme(theme))).not.toContain("zen");
  });

  it("paint the workspace and the document in Zen mode", () => {
    const css = themeStylesheet(resolveTheme(withZen));

    expect(css).toContain(".workspace:has(> .workspace-grid--zen) {");
    expect(css).toContain("background: #f6f1e4; color-scheme: light;");
    expect(css).toContain(".workspace-grid--zen .editor-view__surface.prose {");
  });
});
