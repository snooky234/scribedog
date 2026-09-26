import { isMermaidLanguage } from "@/lib/diagrams/mermaidBlocks";

import { base64ToBytes, bytesToBase64, rasterizeToPng, type ExportImageAsset, type ExportImageMap } from "./imageAssets";
import type { ExportBlock } from "./markdownModel";

// Pixel density of the PNG the paged formats (PDF/DOCX/ODT/EPUB) receive; the
// image run keeps the diagram's CSS width, so it prints at its natural size
// but twice as sharp. HTML gets the SVG itself.
const RASTER_SCALE = 2;

// Never a relative path, so it cannot collide with an image src from the note.
const DIAGRAM_SRC_PREFIX = "scribedog-diagram:";
// Module-wide, so a manuscript's chapters (one call each, one shared image
// map) never hand out the same key twice.
let diagramCounter = 0;

type RenderSvg = (source: string) => Promise<string>;

async function defaultRenderSvg(source: string): Promise<string> {
  const { renderMermaidSvg } = await import("@/lib/diagrams/mermaidRenderer");
  return renderMermaidSvg(source, "export");
}

/**
 * Mermaid draws with width="100%" and a max-width style, which as an <img>
 * has no intrinsic size. The viewBox is the drawing's real size in px.
 */
export function withIntrinsicSize(svg: string): { svg: string; width: number; height: number } | null {
  const parsed = new DOMParser().parseFromString(svg, "text/html");
  const root = parsed.querySelector("svg");
  const viewBox = root?.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);

  if (!root || !viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const width = Math.max(1, Math.ceil(viewBox[2]));
  const height = Math.max(1, Math.ceil(viewBox[3]));

  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.style.removeProperty("max-width");
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  return { svg: new XMLSerializer().serializeToString(root), width, height };
}

async function diagramAsset(svg: string): Promise<{ asset: ExportImageAsset; cssWidth: number } | null> {
  const sized = withIntrinsicSize(svg);

  if (!sized) {
    return null;
  }

  const originalDataUrl = `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(sized.svg))}`;
  const { pngDataUrl, width, height } = await rasterizeToPng(originalDataUrl, RASTER_SCALE);

  return {
    asset: {
      originalDataUrl,
      pngDataUrl,
      pngBytes: base64ToBytes(pngDataUrl.slice(pngDataUrl.indexOf(",") + 1)),
      width,
      height
    },
    cssWidth: sized.width
  };
}

/**
 * Replaces every ```mermaid block with a centred image of the drawing and
 * adds that image to `images`. A diagram that does not render (syntax error,
 * canvas refused the SVG) stays a code block, so the export still carries it.
 */
export async function embedDiagrams(
  blocks: ExportBlock[],
  images: ExportImageMap,
  renderSvg: RenderSvg = defaultRenderSvg
): Promise<ExportBlock[]> {
  const convert = async (list: ExportBlock[]): Promise<ExportBlock[]> => {
    const result: ExportBlock[] = [];

    for (const block of list) {
      switch (block.kind) {
        case "codeBlock": {
          if (!isMermaidLanguage(block.language) || !block.text.trim()) {
            result.push(block);
            break;
          }

          try {
            const rendered = await diagramAsset(await renderSvg(block.text));

            if (!rendered) {
              result.push(block);
              break;
            }

            diagramCounter += 1;
            const src = `${DIAGRAM_SRC_PREFIX}${diagramCounter}`;
            images.set(src, rendered.asset);
            result.push({
              kind: "paragraph",
              align: "center",
              runs: [{ kind: "image", src, alt: "Diagram", width: rendered.cssWidth }]
            });
          } catch {
            result.push(block);
          }
          break;
        }
        case "blockquote":
          result.push({ ...block, children: await convert(block.children) });
          break;
        case "list": {
          const items = [];

          for (const item of block.items) {
            items.push({ ...item, children: await convert(item.children) });
          }

          result.push({ ...block, items });
          break;
        }
        default:
          result.push(block);
      }
    }

    return result;
  };

  return hasDiagram(blocks) ? convert(blocks) : blocks;
}

function hasDiagram(blocks: ExportBlock[]): boolean {
  return blocks.some((block) => {
    switch (block.kind) {
      case "codeBlock":
        return isMermaidLanguage(block.language);
      case "blockquote":
        return hasDiagram(block.children);
      case "list":
        return block.items.some((item) => hasDiagram(item.children));
      default:
        return false;
    }
  });
}
