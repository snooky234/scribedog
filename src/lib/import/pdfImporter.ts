import { readFile } from "@tauri-apps/plugin-fs";

import {
  getRelativeImageMarkdownPath,
  saveImageToFolder
} from "@/lib/fileSystem";
import {
  blocksToMarkdown,
  buildTableMarkdown,
  detectCheckboxes,
  detectTables,
  collectPageLines,
  linesToBlocks,
  scanOperators,
  type Block,
  type OpsConstants,
  type PlacedImage,
  type VectorPath
} from "./pdfStructure";

// ---------------------------------------------------------------------------
// Image extraction
// ---------------------------------------------------------------------------

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        resolve(null);
        return;
      }

      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

// Converts a decoded pdf.js image object to a PNG via canvas. Since pdf.js 4+
// decoded images usually arrive as an ImageBitmap ("bitmap"); the raw
// RGB/RGBA/grayscale "data" shape is the fallback path. Returns null when the
// shape is not understood.
function imageObjectToPng(imageObject: {
  width?: number;
  height?: number;
  data?: Uint8Array | Uint8ClampedArray | null;
  bitmap?: ImageBitmap | null;
}): Promise<Uint8Array | null> {
  const { width, height, data, bitmap } = imageObject;

  if (bitmap) {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");

    if (!context) {
      return Promise.resolve(null);
    }

    context.drawImage(bitmap, 0, 0);

    return canvasToPngBytes(canvas);
  }

  if (!width || !height || !data || data.length === 0) {
    return Promise.resolve(null);
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  const pixelCount = width * height;

  if (data.length === pixelCount * 4) {
    rgba.set(data);
  } else if (data.length === pixelCount * 3) {
    for (let index = 0; index < pixelCount; index += 1) {
      rgba[index * 4] = data[index * 3];
      rgba[index * 4 + 1] = data[index * 3 + 1];
      rgba[index * 4 + 2] = data[index * 3 + 2];
      rgba[index * 4 + 3] = 255;
    }
  } else if (data.length === pixelCount) {
    for (let index = 0; index < pixelCount; index += 1) {
      rgba[index * 4] = data[index];
      rgba[index * 4 + 1] = data[index];
      rgba[index * 4 + 2] = data[index];
      rgba[index * 4 + 3] = 255;
    }
  } else {
    return Promise.resolve(null);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return Promise.resolve(null);
  }

  context.putImageData(new ImageData(rgba, width, height), 0, 0);

  return canvasToPngBytes(canvas);
}

type PdfObjectStore = {
  get(objId: string, callback?: (value: unknown) => void): unknown;
};

type PdfPageLike = {
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: PdfObjectStore;
  commonObjs: PdfObjectStore;
};

// Waits for a pdf.js image object to be resolved (decoding is async).
// Document-global objects carry a "g_" id prefix and live in commonObjs
// instead of the page-scoped store.
function getResolvedPageObject(page: PdfPageLike, objId: string): Promise<unknown> {
  return new Promise((resolve) => {
    // Never hang the import on an object pdf.js never resolves.
    const timeout = window.setTimeout(() => resolve(null), 10_000);

    try {
      const store = objId.startsWith("g_") ? page.commonObjs : page.objs;
      store.get(objId, (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      });
    } catch {
      window.clearTimeout(timeout);
      resolve(null);
    }
  });
}

// PDF points → CSS pixels (72dpi → 96dpi), matching the editor's width unit.
function pointsToPixels(points: number): number {
  return Math.round((points * 4) / 3);
}

async function extractPlacedImage(
  page: PdfPageLike,
  placement: PlacedImage,
  vaultRoot: string,
  targetFilePath: string,
  imageBaseName: string
): Promise<string | null> {
  // Image decoding failures must never fail the text import.
  try {
    const imageObject = (await getResolvedPageObject(page, placement.objId)) as {
      width?: number;
      height?: number;
      data?: Uint8Array | null;
      bitmap?: ImageBitmap | null;
    } | null;

    if (!imageObject) {
      return null;
    }

    const pngBytes = await imageObjectToPng(imageObject);

    if (!pngBytes) {
      return null;
    }

    const rootRelativePath = await saveImageToFolder(
      vaultRoot,
      `${imageBaseName}.png`,
      "image/png",
      pngBytes
    );
    const src = await getRelativeImageMarkdownPath(vaultRoot, targetFilePath, rootRelativePath);

    // Preserve the size the image was displayed at in the PDF, using the
    // editor's own width syntax (see the Image extension in Editor.tsx).
    const widthPx = pointsToPixels(placement.widthPt);

    return widthPx > 0 ? `![](${src} "width=${widthPx}")` : `![](${src})`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Converts a PDF to markdown via pdf.js: text with a heading/paragraph
 * heuristic, vector-drawn checkboxes as task-list items, bordered tables as
 * pipe tables, and embedded raster images extracted into the vault's
 * "images/" folder at their displayed size and position. Layout
 * reconstruction is deliberately best effort.
 */
export async function convertPdfToMarkdown(
  sourcePath: string,
  vaultRoot: string,
  targetFilePath: string,
  imageBaseName: string,
  signal?: AbortSignal
): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");

  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const opsConstants: OpsConstants = {
    save: pdfjs.OPS.save,
    restore: pdfjs.OPS.restore,
    transform: pdfjs.OPS.transform,
    constructPath: pdfjs.OPS.constructPath,
    paintImageXObject: pdfjs.OPS.paintImageXObject,
    stroke: pdfjs.OPS.stroke,
    closeStroke: pdfjs.OPS.closeStroke,
    fill: pdfjs.OPS.fill,
    eoFill: pdfjs.OPS.eoFill,
    fillStroke: pdfjs.OPS.fillStroke,
    eoFillStroke: pdfjs.OPS.eoFillStroke
  };

  const fileBytes = await readFile(sourcePath);
  const pdfDocument = await pdfjs.getDocument({ data: fileBytes }).promise;

  try {
    const pageMarkdowns: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      if (signal?.aborted) {
        break;
      }

      const page = (await pdfDocument.getPage(pageNumber)) as unknown as PdfPageLike;

      const textContent = await page.getTextContent();
      const textItems: Array<{ x: number; y: number; fontSize: number; text: string }> = [];

      for (const rawItem of textContent.items) {
        const item = rawItem as { str?: string; transform?: number[] };

        if (typeof item.str !== "string" || !item.transform || !item.str.trim()) {
          continue;
        }

        textItems.push({
          x: item.transform[4],
          y: item.transform[5],
          fontSize: Math.hypot(item.transform[2], item.transform[3]) || 12,
          text: item.str
        });
      }

      let paths: VectorPath[] = [];
      let placedImages: PlacedImage[] = [];

      try {
        const operatorList = await page.getOperatorList();
        ({ paths, images: placedImages } = scanOperators(operatorList, opsConstants));
      } catch {
        // Vector analysis failures must never fail the text import.
      }

      const tables = detectTables(paths);
      const checkboxes = detectCheckboxes(paths);
      const blocks: Block[] = [];

      // Table cells are removed from the regular text flow and re-emitted as
      // one pipe-table block anchored at the table's top edge.
      const freeItems = textItems.filter(
        (item) =>
          !tables.some(
            (table) =>
              item.x >= table.rect.x1 - 2 &&
              item.x <= table.rect.x2 + 2 &&
              item.y >= table.rect.y1 - 2 &&
              item.y <= table.rect.y2 + 2
          )
      );

      for (const table of tables) {
        const tableItems = textItems.filter(
          (item) =>
            item.x >= table.rect.x1 - 2 &&
            item.x <= table.rect.x2 + 2 &&
            item.y >= table.rect.y1 - 2 &&
            item.y <= table.rect.y2 + 2
        );

        if (tableItems.length > 0) {
          blocks.push({
            y: table.rect.y2,
            markdown: buildTableMarkdown(table, tableItems),
            kind: "table"
          });
        }
      }

      blocks.push(...linesToBlocks(collectPageLines(freeItems), checkboxes));

      for (const placement of placedImages) {
        const markdown = await extractPlacedImage(
          page,
          placement,
          vaultRoot,
          targetFilePath,
          imageBaseName
        );

        if (markdown) {
          blocks.push({ y: placement.yTop, markdown, kind: "image" });
        }
      }

      const pageMarkdown = blocksToMarkdown(blocks);

      if (pageMarkdown) {
        pageMarkdowns.push(pageMarkdown);
      }
    }

    return pageMarkdowns.join("\n\n");
  } finally {
    await (pdfDocument as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
}
