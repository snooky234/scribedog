// The preset sizes offered for an image (its right-click menu, and the bar on
// a selected image on touch screens; see ImageView). A percentage is a share
// of the page width, the column the image sits in, whatever the picture's own
// size: "50 %" is half the page for a screenshot and for an icon alike (the
// icon then grows past its own pixels, which is what was asked for).
// "Original" drops the stored width, so the image shows at its own size again,
// capped by the column.
//
// The width is still stored in pixels (`width=…` in the Markdown title), so
// the format, every export and the agent's set_image_width stay unchanged. The
// percentage is an input aid on the device it was picked on: a narrower screen
// caps the image at its column (max-width: 100%), so a size chosen on a wide
// screen never turns tiny on a phone.

export const IMAGE_SCALE_STEPS = [25, 50, 75, 100] as const;

export type ImageScaleStep = (typeof IMAGE_SCALE_STEPS)[number];

/** A step of the page width, or the image's own size (no stored width). */
export type ImageScaleChoice = ImageScaleStep | "original";

export const IMAGE_SCALE_CHOICES: readonly ImageScaleChoice[] = [...IMAGE_SCALE_STEPS, "original"];

// Rounding and a column that changed by a pixel since the step was chosen
// should still mark that step as the current one.
const ACTIVE_TOLERANCE_PX = 2;

/** The width attribute for a choice: null (no stored width) for the original size. */
export function widthForImageScale(choice: ImageScaleChoice, pageWidth: number, minWidth: number): number | null {
  if (choice === "original") {
    return null;
  }

  return Math.max(minWidth, Math.round((pageWidth * choice) / 100));
}

/** Whether a choice can be applied: the steps need a measured page width. */
export function canApplyImageScale(choice: ImageScaleChoice, pageWidth: number | null): boolean {
  return choice === "original" || (pageWidth !== null && pageWidth > 0);
}

/** The choice the current width corresponds to, if any. */
export function activeImageScale(width: number | null, pageWidth: number | null): ImageScaleChoice | null {
  if (width === null) {
    return "original";
  }

  if (pageWidth === null || pageWidth <= 0) {
    return null;
  }

  return (
    IMAGE_SCALE_STEPS.find((step) => Math.abs((pageWidth * step) / 100 - width) <= ACTIVE_TOLERANCE_PX) ?? null
  );
}
