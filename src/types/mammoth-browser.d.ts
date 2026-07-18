declare module "mammoth/mammoth.browser" {
  export type MammothImage = {
    contentType: string;
    read(encoding: "base64"): Promise<string>;
  };

  export type MammothImageConverter = {
    "mammoth.imageConverter": (image: MammothImage) => Promise<Record<string, string>>;
  };

  export const images: {
    imgElement(
      convert: (image: MammothImage) => Promise<Record<string, string>>
    ): MammothImageConverter;
  };

  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: { convertImage?: MammothImageConverter }
  ): Promise<{ value: string; messages: Array<{ type: string; message: string }> }>;
}
