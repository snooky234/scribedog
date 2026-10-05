/**
 * OKLab conversions and a parser for the colour spellings tokens.css uses.
 *
 * Theme derivation works in OKLab rather than sRGB or HSL because its
 * lightness axis is perceptual: "hover is 0.043 lighter than the surface"
 * then looks like the same step on a near-black and on a mid-gray surface,
 * which is what keeps a custom theme's hover/active rows in the same visual
 * distance as the built-in ones.
 */

import type { Rgb } from "@/lib/color";

export type Oklab = { l: number; a: number; b: number };

/** A parsed CSS colour: sRGB channels 0–255 (unrounded) plus alpha 0–1. */
export type CssColor = Rgb & { alpha: number };

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const c = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return c * 255;
}

export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  };
}

/** Back to sRGB, clamped into gamut but not rounded. */
export function oklabToRgb({ l, a, b }: Oklab): Rgb {
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const clamp = (value: number) => Math.min(255, Math.max(0, linearToSrgb(value)));
  return {
    r: clamp(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    g: clamp(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    b: clamp(-0.0041960863 * lc - 0.7034186147 * mc + 1.7076127461 * sc)
  };
}

function oklchToRgb(l: number, c: number, hueDegrees: number): Rgb {
  const h = (hueDegrees * Math.PI) / 180;
  return oklabToRgb({ l, a: c * Math.cos(h), b: c * Math.sin(h) });
}

const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
const TRIPLET = /^(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})$/;
const RGBA = /^rgba?\(\s*(\d{1,3})[,\s]\s*(\d{1,3})[,\s]\s*(\d{1,3})(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/;
const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/;

function parseAlpha(value: string | undefined, percent: string | undefined): number {
  if (value === undefined) {
    return 1;
  }
  const number = Number.parseFloat(value);
  return percent ? number / 100 : number;
}

/**
 * Parses the four spellings the palette uses: `#rrggbb` (with an optional
 * `aa` suffix, which only the highlight colours use), a bare `r, g, b`
 * triplet (the `--*-rgb` tokens), `rgb()`/`rgba()` and `oklch()` (the
 * shadcn tokens). Anything else is `null` — this is not a general CSS
 * colour parser.
 */
export function parseCssColor(value: string): CssColor | null {
  const input = value.trim();

  const hex = HEX.exec(input);
  if (hex) {
    const int = Number.parseInt(hex[1], 16);
    const alpha = hex[2] === undefined ? 1 : Number.parseInt(hex[2], 16) / 255;
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, alpha };
  }

  const triplet = TRIPLET.exec(input);
  if (triplet) {
    return { r: Number(triplet[1]), g: Number(triplet[2]), b: Number(triplet[3]), alpha: 1 };
  }

  const rgba = RGBA.exec(input);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      alpha: parseAlpha(rgba[4], rgba[5])
    };
  }

  const oklch = OKLCH.exec(input);
  if (oklch) {
    const rgb = oklchToRgb(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]));
    return { ...rgb, alpha: parseAlpha(oklch[4], oklch[5]) };
  }

  return null;
}
