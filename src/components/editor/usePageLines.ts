import { useEffect, useRef } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";

import { embedDiagrams, type DiagramCache } from "@/lib/export/diagramAssets";
import { numberExportBlocks } from "@/lib/export/headingNumbers";
import { collectImageSrcs, loadExportImages, type ExportImageMap } from "@/lib/export/imageAssets";
import { pageBreakKeepMask, parseMarkdownToBlocksWithLines } from "@/lib/export/markdownModel";
import { remapBlockIndices } from "@/lib/export/pageMap";
import { requestPageMap } from "@/lib/export/pageMapClient";
import { pageLineMarks } from "@/lib/editor/pageLineMapping";
import { createInnerResolver, serializeTopLevelNodes } from "@/lib/editor/pageLinesInput";
import { setPageLineMarks } from "@/lib/editor/pageLines";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

/** How long typing has to pause before the pages are laid out again. */
const PAGE_LINES_DELAY_MS = 800;

type ImageSize = { width: number; height: number };

/**
 * Keeps the editor's page lines (lib/editor/pageLines.ts) in step with the
 * PDF export while `enabled`: laid out on start, after every pause in typing,
 * and whenever a setting that moves the pages changes. The layout runs in a
 * worker (pageMapClient.ts) on the same blocks the export would render;
 * images and diagrams go in as their sizes only, cached per note.
 */
export function usePageLines({
  editor,
  filePath,
  enabled
}: {
  editor: TipTapEditor | null;
  filePath: string | null;
  enabled: boolean;
}): void {
  const fontId = useEditorSettingsStore((state) => state.fontId);
  const fontSizePt = useEditorSettingsStore((state) => state.fontSizePt);
  const pageSize = useEditorSettingsStore((state) => state.pageSize);
  const pageMargins = useEditorSettingsStore((state) => state.pageMargins);
  const tableWidth = useEditorSettingsStore((state) => state.tableWidth);
  const headingNumbering = useEditorSettingsStore((state) => state.headingNumbering);
  const imageSizes = useRef(new Map<string, ImageSize | null>());
  const diagrams = useRef<DiagramCache>(new Map());

  useEffect(() => {
    if (!editor || !enabled) {
      if (editor) {
        setPageLineMarks(editor, null);
      }

      return;
    }

    const style = { fontId, fontSizePt, headingNumbering, tableWidth, pageSize, pageMargins };
    let disposed = false;
    let generation = 0;
    let timer: number | undefined;

    const sizesFor = async (srcs: string[]): Promise<Array<[string, ImageSize]>> => {
      const key = (src: string) => `${filePath ?? ""}\u0000${src}`;
      const missing = srcs.filter((src) => !imageSizes.current.has(key(src)));

      if (missing.length > 0 && filePath) {
        const loaded = await loadExportImages(filePath, missing);

        for (const src of missing) {
          const asset = loaded.get(src);
          imageSizes.current.set(key(src), asset ? { width: asset.width, height: asset.height } : null);
        }
      }

      return srcs.flatMap((src) => {
        const size = imageSizes.current.get(key(src));
        return size ? [[src, size] as [string, ImageSize]] : [];
      });
    };

    const layout = async () => {
      const run = ++generation;
      const doc = editor.state.doc;
      const { markdown, nodes } = serializeTopLevelNodes(editor);
      const { blocks: parsed, lines } = parseMarkdownToBlocksWithLines(markdown);
      const keep = pageBreakKeepMask(parsed);
      const originalIndices = parsed.flatMap((_, index) => (keep[index] ? [index] : []));
      const kept = originalIndices.map((index) => parsed[index]);
      const sizes = await sizesFor(collectImageSrcs(kept));
      const diagramImages: ExportImageMap = new Map();
      const withDiagrams = await embedDiagrams(kept, diagramImages, undefined, diagrams.current);

      for (const [src, asset] of diagramImages) {
        sizes.push([src, { width: asset.width, height: asset.height }]);
      }

      const map = await requestPageMap({
        blocks: numberExportBlocks(withDiagrams, headingNumbering),
        imageSizes: sizes,
        style
      });

      // A newer run is on its way, or the text moved on while this one was
      // laid out; its positions would no longer fit the document.
      if (disposed || run !== generation || !map || editor.state.doc !== doc) {
        return;
      }

      const pages = remapBlockIndices(map, originalIndices);
      setPageLineMarks(editor, pageLineMarks(pages.pageStarts, lines, nodes, createInnerResolver(doc)));
    };

    const runLayout = () => {
      layout().catch((error: unknown) => {
        console.error("Page lines could not be laid out:", error);
      });
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(runLayout, PAGE_LINES_DELAY_MS);
    };

    editor.on("update", schedule);
    runLayout();

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      editor.off("update", schedule);
      setPageLineMarks(editor, null);
    };
  }, [editor, enabled, filePath, fontId, fontSizePt, pageSize, pageMargins, tableWidth, headingNumbering]);
}
