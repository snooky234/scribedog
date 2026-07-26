// fontkit ships no type declarations and is only reached from
// exportFonts.test.ts, which uses it as pdfmake's font engine to prove every
// catalog face can actually be subset. Declared narrowly — just the surface
// that test touches — rather than pulling in a full ambient typing.
declare module "fontkit" {
  export type FontkitGlyph = { id: number };

  export type FontkitSubset = {
    includeGlyph: (glyphId: number) => void;
    encode: () => Uint8Array;
  };

  export type FontkitFont = {
    postscriptName: string;
    layout: (text: string) => { glyphs: FontkitGlyph[] };
    createSubset: () => FontkitSubset;
  };

  export function create(bytes: Uint8Array): FontkitFont;
}
