/**
 * Derives the app's whole accent-color ramp from one user-picked hex color.
 * The shades' hue/saturation deltas are lifted from the gap between
 * Tailwind's violet-{100,300,400,500,600,900,950} steps — the values the
 * accent color used to be hardcoded to — so a freshly derived ramp keeps the
 * same visual relationships (glow, gradient end, dark chip background, …)
 * for whatever hue the user picks.
 */

export type Hsl = { h: number; s: number; l: number };
export type Rgb = { r: number; g: number; b: number };

const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

export function isValidHexColor(value: string): boolean {
  return HEX_PATTERN.test(value.trim());
}

export function hexToRgb(hex: string): Rgb | null {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) {
    return null;
  }
  const int = Number.parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (channel: number) => Math.round(channel).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: l * 100 };
  }

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  switch (max) {
    case rn:
      h = ((gn - bn) / delta) % 6;
      break;
    case gn:
      h = (bn - rn) / delta + 2;
      break;
    default:
      h = (rn - gn) / delta + 4;
  }
  h *= 60;
  if (h < 0) {
    h += 360;
  }

  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;

  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) {
    [rp, gp, bp] = [c, x, 0];
  } else if (h < 120) {
    [rp, gp, bp] = [x, c, 0];
  } else if (h < 180) {
    [rp, gp, bp] = [0, c, x];
  } else if (h < 240) {
    [rp, gp, bp] = [0, x, c];
  } else if (h < 300) {
    [rp, gp, bp] = [x, 0, c];
  } else {
    [rp, gp, bp] = [c, 0, x];
  }

  return {
    r: (rp + m) * 255,
    g: (gp + m) * 255,
    b: (bp + m) * 255
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** One derived shade's offset from the base color, in HSL space. */
type ShadeOffset = { deltaL: number; deltaS: number };

/** Keyed by CSS custom property suffix, e.g. `--accent-{key}-rgb`. The base
 *  shade has no suffix (`--accent-rgb`). */
const SHADE_OFFSETS: Record<string, ShadeOffset> = {
  pale: { deltaL: 27, deltaS: 9 },
  lighter: { deltaL: 20, deltaS: 6 },
  light: { deltaL: 10, deltaS: 4 },
  dark: { deltaL: -9, deltaS: -10 },
  darker: { deltaL: -34, deltaS: -28 },
  darkest: { deltaL: -46, deltaS: -37 }
};

export type AccentPalette = Record<"base" | keyof typeof SHADE_OFFSETS, string>;

function rgbTriplet(rgb: Rgb): string {
  return `${Math.round(clamp(rgb.r, 0, 255))}, ${Math.round(clamp(rgb.g, 0, 255))}, ${Math.round(clamp(rgb.b, 0, 255))}`;
}

/** Builds the full accent ramp (as `"r, g, b"` triplets, ready for `rgba(var(--x), a)`) from one base hex color. */
export function buildAccentPalette(hex: string): AccentPalette | null {
  const baseRgb = hexToRgb(hex);
  if (!baseRgb) {
    return null;
  }
  const baseHsl = rgbToHsl(baseRgb);

  const palette = { base: rgbTriplet(baseRgb) } as AccentPalette;
  for (const [key, offset] of Object.entries(SHADE_OFFSETS)) {
    const shadeHsl: Hsl = {
      h: baseHsl.h,
      s: clamp(baseHsl.s + offset.deltaS, 0, 100),
      l: clamp(baseHsl.l + offset.deltaL, 2, 98)
    };
    palette[key as keyof typeof SHADE_OFFSETS] = rgbTriplet(hslToRgb(shadeHsl));
  }

  return palette;
}
