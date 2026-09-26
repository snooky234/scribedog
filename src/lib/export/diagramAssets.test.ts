// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("./imageAssets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./imageAssets")>()),
  // jsdom has no canvas; the rasterization itself is exercised in the app.
  rasterizeToPng: vi.fn(async () => ({ pngDataUrl: "data:image/png;base64,AAAA", width: 200, height: 100 }))
}));

import { embedDiagrams, withIntrinsicSize } from "./diagramAssets";
import type { ExportImageMap } from "./imageAssets";
import { parseMarkdownToBlocks } from "./markdownModel";

const SVG = '<svg id="m" width="100%" style="max-width: 99.5px;" viewBox="-8 -8 99.5 40"><g></g></svg>';

describe("withIntrinsicSize", () => {
  it("sizes the SVG from its viewBox and drops the max-width", () => {
    const result = withIntrinsicSize(SVG);

    expect(result?.width).toBe(100);
    expect(result?.height).toBe(40);
    expect(result?.svg).toContain('width="100"');
    expect(result?.svg).not.toContain("max-width");
  });

  it("gives up without a viewBox", () => {
    expect(withIntrinsicSize("<svg></svg>")).toBeNull();
  });
});

describe("embedDiagrams", () => {
  it("replaces mermaid blocks, including nested ones, with a centred image", async () => {
    const blocks = parseMarkdownToBlocks(
      "```mermaid\nflowchart TD\n  A --> B\n```\n\n- item\n\n  ```mermaid\n  pie\n  ```\n\n```js\nx\n```\n"
    );
    const images: ExportImageMap = new Map();
    const result = await embedDiagrams(blocks, images, async () => SVG);

    expect(images.size).toBe(2);
    expect(result[0]).toMatchObject({ kind: "paragraph", align: "center", runs: [{ kind: "image", width: 100 }] });
    expect(result[1]).toMatchObject({ kind: "list", items: [{ children: [{ kind: "paragraph" }, { kind: "paragraph" }] }] });
    expect(result[2]).toMatchObject({ kind: "codeBlock", language: "js" });

    const src = (result[0] as { runs: { src: string }[] }).runs[0].src;
    expect(images.get(src)?.originalDataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("keeps a diagram that fails to render as a code block", async () => {
    const blocks = parseMarkdownToBlocks("```mermaid\nnot a diagram\n```\n");
    const images: ExportImageMap = new Map();
    const result = await embedDiagrams(blocks, images, async () => {
      throw new Error("Parse error");
    });

    expect(result).toEqual(blocks);
    expect(images.size).toBe(0);
  });
});
