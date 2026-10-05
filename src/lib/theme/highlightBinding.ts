/**
 * The binding between the two highlights the theme builder edits: the file
 * tree's and the "In progress" list's.
 *
 * Holding none of the three `openActive*` colours *is* the bound state —
 * that is the condition the fallback in `derive.ts` acts on — so a theme
 * carries the choice without a flag of its own and the format stays colours
 * only. Unbinding therefore has to write the values the list inherits right
 * now into the theme: that is what freezes them, and it is also why
 * unticking the box changes nothing on screen.
 */

import {
  DEFAULT_ADVANCED_COLORS,
  derivedHighlightColor,
  OPEN_ACTIVE_FALLBACK,
  type AdvancedColorKey
} from "./derive";
import type { CustomTheme } from "./themeFormat";

export const OPEN_ACTIVE_KEYS: AdvancedColorKey[] = ["openActiveText", "openActiveBg", "openActiveMarker"];

/** What a colour's field shows: the theme's own pick, or else the value it
 *  currently inherits. For a highlight colour that inherited value is
 *  derived from the base colours, so the field follows a theme's accent
 *  instead of naming the built-in violet. */
export function advancedValue(theme: CustomTheme, key: AdvancedColorKey): string {
  const own = theme.advanced?.[key];
  if (own !== undefined) {
    return own;
  }
  const fallback = OPEN_ACTIVE_FALLBACK[key];
  if (fallback && theme.advanced?.[fallback] !== undefined) {
    return theme.advanced[fallback] as string;
  }
  return (
    derivedHighlightColor(key, theme.mode, theme.base, theme.advanced) ?? DEFAULT_ADVANCED_COLORS[theme.mode][key]
  );
}

/** The tree's counterpart of one of the list's colours: what the list would
 *  wear if it followed the tree. This is where a reset inside an unbound
 *  list goes — clearing the key instead would bind the list again and pull
 *  the fields away while the user is working in them. */
export function treeColorFor(theme: CustomTheme, key: AdvancedColorKey): string {
  const source = OPEN_ACTIVE_FALLBACK[key];
  return advancedValue(theme, source ?? key);
}

/** Whether the "In progress" list still follows the tree's highlight. */
export function isOpenActiveBound(theme: CustomTheme): boolean {
  return OPEN_ACTIVE_KEYS.every((key) => theme.advanced?.[key] === undefined);
}

/** Ties the list's highlight back to the tree's, or cuts it loose at the
 *  colours it shows at that moment. */
export function setOpenActiveBound(theme: CustomTheme, bound: boolean): CustomTheme {
  const advanced = { ...theme.advanced };
  for (const key of OPEN_ACTIVE_KEYS) {
    if (bound) {
      delete advanced[key];
    } else {
      advanced[key] = advancedValue(theme, key);
    }
  }
  return { ...theme, advanced: Object.keys(advanced).length > 0 ? advanced : undefined };
}
