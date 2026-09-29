/**
 * Pure math for the text zoom of Zen mode and the normal editor's view: a
 * pinch (Zen only) or Ctrl+wheel scales the document text the way an e-book
 * reader does, without touching the page zoom. The hook (`useFontZoom`)
 * only feeds it touch points and wheel deltas, so the rules live here where
 * they can be tested without a browser.
 */

import { DEFAULT_FONT_SIZE_PT } from "@/lib/fonts";

export type TouchPoint = { x: number; y: number };

/**
 * Wider than the settings dialog's document size on purpose: the Zen column
 * is read from the couch or a phone held at arm's length.
 */
export const ZEN_FONT_SIZE_PT_MIN = 8;
export const ZEN_FONT_SIZE_PT_MAX = 32;
export const ZEN_FONT_SIZE_PT_STEP = 0.5;

/**
 * Wheel delta (in pixels, per `deltaMode` 0) that moves the size by one
 * step. A mouse notch is 100 in Chromium, so one notch is one point; a
 * trackpad pinch delivers many small deltas and glides through the range.
 */
export const ZEN_WHEEL_PX_PER_STEP = 50;

export function clampZenFontSizePt(sizePt: number): number {
  if (!Number.isFinite(sizePt)) {
    return ZEN_FONT_SIZE_PT_MIN;
  }

  const stepped = Math.round(sizePt / ZEN_FONT_SIZE_PT_STEP) * ZEN_FONT_SIZE_PT_STEP;
  return Math.min(ZEN_FONT_SIZE_PT_MAX, Math.max(ZEN_FONT_SIZE_PT_MIN, stepped));
}

/**
 * Factor for `--document-font-scale`. `getFontScale` in fonts.ts clamps to
 * the settings range, which is narrower than the reader range here.
 */
export function getZenFontScale(sizePt: number): number {
  return clampZenFontSizePt(sizePt) / DEFAULT_FONT_SIZE_PT;
}

export function distanceBetween(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * The size while a pinch is in progress: the size at the start of the
 * gesture scaled by how far the fingers have moved apart. A gesture that
 * starts with the fingers touching has no ratio and keeps the size.
 */
export function pinchedFontSizePt(startSizePt: number, startDistance: number, currentDistance: number): number {
  if (startDistance <= 0) {
    return clampZenFontSizePt(startSizePt);
  }

  return clampZenFontSizePt(startSizePt * (currentDistance / startDistance));
}

export type WheelZoomState = {
  sizePt: number;
  /** Wheel pixels not yet worth a whole step; carried into the next event. */
  carry: number;
};

/**
 * Applies one wheel event. Scrolling up (negative delta) enlarges, matching
 * browser zoom. Deltas below one step accumulate so a trackpad's fine pinch
 * still moves the size, and the remainder is dropped at either limit so a
 * long scroll past the end does not have to be scrolled back first.
 */
export function applyWheelZoom(state: WheelZoomState, deltaY: number): WheelZoomState {
  const total = state.carry - deltaY;
  const steps = Math.trunc(total / ZEN_WHEEL_PX_PER_STEP);
  const sizePt = clampZenFontSizePt(state.sizePt + steps * ZEN_FONT_SIZE_PT_STEP);
  const atLimit = sizePt === ZEN_FONT_SIZE_PT_MIN || sizePt === ZEN_FONT_SIZE_PT_MAX;

  return { sizePt, carry: atLimit ? 0 : total - steps * ZEN_WHEEL_PX_PER_STEP };
}

/** Ctrl+wheel, or Cmd+wheel on a Mac: the combination browsers zoom on. */
export function isZoomWheel(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}
