import { bytesToBase64 } from "@/lib/imageEncoding";
import { APP_FONTS, type AppFontId } from "@/lib/fonts";

// Registers a catalog font with pdfmake. pdfmake embeds a subset of the face
// into the PDF, so it needs the actual font bytes — the WOFF1 files, since
// fontkit's subsetter cannot decode WOFF2's transformed glyf table (see
// src/lib/fonts.ts and exportFonts.test.ts).
//
// The `?url` imports only put the file names into the bundle; Vite emits the
// assets and the bytes are fetched on the first PDF export that needs them.

import ebGaramondNormal from "@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff?url";
import ebGaramondItalic from "@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff?url";
import ebGaramondBold from "@fontsource/eb-garamond/files/eb-garamond-latin-700-normal.woff?url";
import ebGaramondBoldItalic from "@fontsource/eb-garamond/files/eb-garamond-latin-700-italic.woff?url";

import libreBaskervilleNormal from "@fontsource/libre-baskerville/files/libre-baskerville-latin-400-normal.woff?url";
import libreBaskervilleItalic from "@fontsource/libre-baskerville/files/libre-baskerville-latin-400-italic.woff?url";
import libreBaskervilleBold from "@fontsource/libre-baskerville/files/libre-baskerville-latin-700-normal.woff?url";
import libreBaskervilleBoldItalic from "@fontsource/libre-baskerville/files/libre-baskerville-latin-700-italic.woff?url";

import latoNormal from "@fontsource/lato/files/lato-latin-400-normal.woff?url";
import latoItalic from "@fontsource/lato/files/lato-latin-400-italic.woff?url";
import latoBold from "@fontsource/lato/files/lato-latin-700-normal.woff?url";
import latoBoldItalic from "@fontsource/lato/files/lato-latin-700-italic.woff?url";

import interNormal from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import interItalic from "@fontsource/inter/files/inter-latin-400-italic.woff?url";
import interBold from "@fontsource/inter/files/inter-latin-700-normal.woff?url";
import interBoldItalic from "@fontsource/inter/files/inter-latin-700-italic.woff?url";

import merriweatherNormal from "@fontsource/merriweather/files/merriweather-latin-400-normal.woff?url";
import merriweatherItalic from "@fontsource/merriweather/files/merriweather-latin-400-italic.woff?url";
import merriweatherBold from "@fontsource/merriweather/files/merriweather-latin-700-normal.woff?url";
import merriweatherBoldItalic from "@fontsource/merriweather/files/merriweather-latin-700-italic.woff?url";

import courierPrimeNormal from "@fontsource/courier-prime/files/courier-prime-latin-400-normal.woff?url";
import courierPrimeItalic from "@fontsource/courier-prime/files/courier-prime-latin-400-italic.woff?url";
import courierPrimeBold from "@fontsource/courier-prime/files/courier-prime-latin-700-normal.woff?url";
import courierPrimeBoldItalic from "@fontsource/courier-prime/files/courier-prime-latin-700-italic.woff?url";

import jetBrainsMonoNormal from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?url";
import jetBrainsMonoItalic from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-italic.woff?url";
import jetBrainsMonoBold from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff?url";
import jetBrainsMonoBoldItalic from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-italic.woff?url";

/** pdfmake's own bundled face — the fallback whenever no catalog font applies. */
export const PDF_DEFAULT_FONT = "Roboto";

type PdfFontStyleUrls = {
  normal: string;
  bold: string;
  italics: string;
  bolditalics: string;
};

type PdfFontRegistrar = {
  addVirtualFileSystem: (vfs: Record<string, string>) => void;
  addFonts: (fonts: Record<string, unknown>) => void;
};

export const PDF_EMBEDDABLE_FONTS: Partial<Record<AppFontId, PdfFontStyleUrls>> = {
  "eb-garamond": {
    normal: ebGaramondNormal,
    bold: ebGaramondBold,
    italics: ebGaramondItalic,
    bolditalics: ebGaramondBoldItalic
  },
  "libre-baskerville": {
    normal: libreBaskervilleNormal,
    bold: libreBaskervilleBold,
    italics: libreBaskervilleItalic,
    bolditalics: libreBaskervilleBoldItalic
  },
  lato: {
    normal: latoNormal,
    bold: latoBold,
    italics: latoItalic,
    bolditalics: latoBoldItalic
  },
  inter: {
    normal: interNormal,
    bold: interBold,
    italics: interItalic,
    bolditalics: interBoldItalic
  },
  merriweather: {
    normal: merriweatherNormal,
    bold: merriweatherBold,
    italics: merriweatherItalic,
    bolditalics: merriweatherBoldItalic
  },
  "courier-prime": {
    normal: courierPrimeNormal,
    bold: courierPrimeBold,
    italics: courierPrimeItalic,
    bolditalics: courierPrimeBoldItalic
  },
  "jetbrains-mono": {
    normal: jetBrainsMonoNormal,
    bold: jetBrainsMonoBold,
    italics: jetBrainsMonoItalic,
    bolditalics: jetBrainsMonoBoldItalic
  }
};

// pdfmake keeps its VFS on the module singleton, so a face registered once
// stays registered for the rest of the session.
const registeredFontIds = new Set<AppFontId>();

async function fetchFontBase64(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load font asset: ${url}`);
  }

  return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
}

/**
 * Makes `fontId` available to pdfmake and returns the font name to use in the
 * document definition. Falls back to Roboto for the system font and whenever
 * loading the face fails, so an export never dies over a font.
 */
export async function registerPdfFont(
  pdfMake: PdfFontRegistrar,
  fontId: AppFontId
): Promise<string> {
  const styles = PDF_EMBEDDABLE_FONTS[fontId];

  if (!styles) {
    return PDF_DEFAULT_FONT;
  }

  const fontName = APP_FONTS[fontId].familyName;

  if (registeredFontIds.has(fontId)) {
    return fontName;
  }

  try {
    const styleNames = ["normal", "bold", "italics", "bolditalics"] as const;
    const base64ByStyle = await Promise.all(
      styleNames.map((styleName) => fetchFontBase64(styles[styleName]))
    );

    const vfs: Record<string, string> = {};
    const fontFiles: Record<string, string> = {};

    styleNames.forEach((styleName, index) => {
      const virtualFileName = `${fontId}-${styleName}.woff`;
      vfs[virtualFileName] = base64ByStyle[index];
      fontFiles[styleName] = virtualFileName;
    });

    pdfMake.addVirtualFileSystem(vfs);
    pdfMake.addFonts({ [fontName]: fontFiles });
    registeredFontIds.add(fontId);

    return fontName;
  } catch {
    return PDF_DEFAULT_FONT;
  }
}
