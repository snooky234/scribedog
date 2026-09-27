import { describe, expect, it } from "vitest";

import type { ExportImageMap } from "./imageAssets";
import { captionAfter, isImageCaption, isShortBlock } from "./keepTogether";
import { parseMarkdownToBlocks } from "./markdownModel";

const images: ExportImageMap = new Map([
  ["a.png", { originalDataUrl: "", pngDataUrl: "", pngBytes: new Uint8Array(), width: 10, height: 10 }]
]);

describe("isImageCaption", () => {
  it.each([
    ["*Figure 1: The harbour*", true],
    ["_Figure 1_", true],
    ["***Bold italic caption***", true],
    ["*Figure* and plain text", false],
    ["Plain text", false],
    ["*   *", false]
  ])("reads %s as a caption: %s", (markdown, expected) => {
    expect(isImageCaption(parseMarkdownToBlocks(`${markdown}\n`)[0])).toBe(expected);
  });
});

describe("captionAfter", () => {
  it("finds the italic paragraph under an image-only paragraph", () => {
    const blocks = parseMarkdownToBlocks("![a](a.png)\n\n*Figure 1*\n");

    expect(captionAfter(blocks, 0, images)).toBe(blocks[1]);
  });

  it("needs the image alone in its paragraph", () => {
    const blocks = parseMarkdownToBlocks("See ![a](a.png)\n\n*Figure 1*\n");

    expect(captionAfter(blocks, 0, images)).toBeNull();
  });

  it("needs an image that could be loaded", () => {
    const blocks = parseMarkdownToBlocks("![b](missing.png)\n\n*Figure 1*\n");

    expect(captionAfter(blocks, 0, images)).toBeNull();
  });
});

describe("isShortBlock", () => {
  it("counts the lines of a code block and the rows of a table", () => {
    const [shortCode, longCode, shortTable, longTable] = parseMarkdownToBlocks(
      [
        "```\na\nb\nc\n```",
        "```\na\nb\nc\nd\n```",
        "| A |\n| - |\n| 1 |\n| 2 |",
        "| A |\n| - |\n| 1 |\n| 2 |\n| 3 |"
      ].join("\n\n")
    );

    expect(isShortBlock(shortCode)).toBe(true);
    expect(isShortBlock(longCode)).toBe(false);
    expect(isShortBlock(shortTable)).toBe(true);
    expect(isShortBlock(longTable)).toBe(false);
  });
});
