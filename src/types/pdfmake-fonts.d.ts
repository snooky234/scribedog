// The pdfmake font container bundles ship without type declarations.
declare module "pdfmake/build/fonts/Roboto.js" {
  const fontContainer: { vfs: Record<string, unknown>; fonts: Record<string, unknown> };
  export default fontContainer;
}

declare module "pdfmake/build/standard-fonts/Courier.js" {
  const fontContainer: { vfs: Record<string, unknown>; fonts: Record<string, unknown> };
  export default fontContainer;
}
