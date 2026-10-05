import { describe, expect, it } from "vitest";

import { deriveThemeVariables, DEFAULT_BASE_COLORS } from "./derive";
import {
  advancedValue,
  isOpenActiveBound,
  OPEN_ACTIVE_KEYS,
  setOpenActiveBound,
  treeColorFor
} from "./highlightBinding";
import type { CustomTheme } from "./themeFormat";

const theme: CustomTheme = {
  id: "t",
  name: "T",
  mode: "dark",
  base: { ...DEFAULT_BASE_COLORS.dark, accent: "#a86c44" }
};

describe("the highlight binding", () => {
  it("starts bound, since a fresh theme sets none of the list's colours", () => {
    expect(isOpenActiveBound(theme)).toBe(true);
  });

  it("shows the tree's colour in the list's field while bound", () => {
    const tuned = setOpenActiveBound(theme, true);
    expect(advancedValue(tuned, "openActiveMarker")).toBe(advancedValue(tuned, "activeMarker"));
  });

  it("counts as unbound once the list holds its own colours", () => {
    expect(isOpenActiveBound(setOpenActiveBound(theme, false))).toBe(false);
  });

  // The point of freezing on untick: the list has to keep looking exactly
  // as it did, so unticking the box is not itself a visible change.
  it("changes nothing on screen when it is cut loose", () => {
    const loose = setOpenActiveBound(theme, false);
    const before = deriveThemeVariables(theme.mode, theme.base, theme.advanced);
    const after = deriveThemeVariables(loose.mode, loose.base, loose.advanced);

    for (const name of ["--open-active-text", "--open-active-bg", "--open-active-marker"]) {
      expect(after[name], name).toBe(before[name]);
    }
  });

  // What the user asked for: style the tree differently and the list stays
  // where the theme had it.
  it("keeps the list still once unbound while the tree is restyled", () => {
    const loose = setOpenActiveBound(theme, false);
    const restyled: CustomTheme = { ...loose, advanced: { ...loose.advanced, activeMarker: "#00ccff" } };
    const vars = deriveThemeVariables(restyled.mode, restyled.base, restyled.advanced);

    expect(vars["--tree-active-marker"]).not.toBe(vars["--open-active-marker"]);
    expect(vars["--open-active-marker"]).toBe(
      deriveThemeVariables(loose.mode, loose.base, loose.advanced)["--open-active-marker"]
    );
  });

  it("drags the list along again after it is bound back", () => {
    const loose = setOpenActiveBound(theme, false);
    const restyled: CustomTheme = { ...loose, advanced: { ...loose.advanced, activeMarker: "#00ccff" } };
    const bound = setOpenActiveBound(restyled, true);
    const vars = deriveThemeVariables(bound.mode, bound.base, bound.advanced);

    expect(OPEN_ACTIVE_KEYS.every((key) => bound.advanced?.[key] === undefined)).toBe(true);
    expect(vars["--open-active-marker"]).toBe(vars["--tree-active-marker"]);
  });

  // Binding back must not leave an empty object behind, or a theme that
  // only ever touched these colours would no longer equal a fresh one.
  it("leaves no advanced block behind when nothing else is set", () => {
    expect(setOpenActiveBound(setOpenActiveBound(theme, false), true).advanced).toBeUndefined();
  });

  // A reset inside an unbound list goes back to the tree's colour, not to
  // no colour: clearing the key would rebind the list and take the fields
  // off the screen while the user is working in them.
  it("resets one colour to the tree's without rebinding the list", () => {
    const loose = setOpenActiveBound(theme, false);
    const changed: CustomTheme = {
      ...loose,
      advanced: { ...loose.advanced, openActiveMarker: "#00ccff" }
    };
    const reset: CustomTheme = {
      ...changed,
      advanced: { ...changed.advanced, openActiveMarker: treeColorFor(changed, "openActiveMarker") }
    };

    expect(isOpenActiveBound(reset)).toBe(false);
    expect(advancedValue(reset, "openActiveMarker")).toBe(advancedValue(reset, "activeMarker"));
  });
});
