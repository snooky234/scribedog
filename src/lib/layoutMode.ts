/**
 * The three layouts the workspace can take. Width decides for a mouse; a
 * touch screen (`pointer: coarse`) counts as a tablet up to a larger width,
 * because every iPad is wider than a narrow desktop window in both
 * orientations and still needs the toolbar above the on-screen keyboard.
 * Touch target sizes stay a separate axis, handled in CSS via
 * `pointer: coarse` alone.
 */
export type LayoutMode = "phone" | "tablet" | "desktop";

/** Up to here the sidebar is a sheet and the chat covers the whole screen. */
export const PHONE_MAX_WIDTH = 640;
/** Up to here the sidebar is docked but the chat and details are sheets. */
export const TABLET_MAX_WIDTH = 920;
/** Up to here a touch screen gets the tablet layout (iPad Pro 13" landscape). */
export const TOUCH_TABLET_MAX_WIDTH = 1400;

export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;
/** Touch tablet, either orientation. */
export const TOUCH_TABLET_QUERY = `(pointer: coarse) and (max-width: ${TOUCH_TABLET_MAX_WIDTH}px)`;
/** A media query list: either condition makes the layout a tablet (or phone). */
export const TABLET_QUERY = `(max-width: ${TABLET_MAX_WIDTH}px), ${TOUCH_TABLET_QUERY}`;
/**
 * A touch tablet held upright: too narrow for the docked sidebar next to the
 * text, so it becomes a sheet as on the phone. Limited to touch so that
 * resizing a desktop window taller does not make the file list disappear.
 */
export const TABLET_PORTRAIT_QUERY = `${TOUCH_TABLET_QUERY} and (orientation: portrait)`;

export function layoutModeForWidth(width: number, touch = false): LayoutMode {
  if (width <= PHONE_MAX_WIDTH) {
    return "phone";
  }

  if (width <= TABLET_MAX_WIDTH || (touch && width <= TOUCH_TABLET_MAX_WIDTH)) {
    return "tablet";
  }

  return "desktop";
}
