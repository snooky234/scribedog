import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import i18n from "@/i18n";
import type { PageLineMark } from "@/lib/editor/pageLineMapping";

// "Show page breaks": where the pages of the PDF export (and the print) end,
// drawn into the editor as decorations only. Nothing is written into the
// document, and the export does not depend on it: both follow the same page
// plan (export/pagePlan.ts, marks from components/editor/usePageLines.ts).
//
// A page that begins between two top-level blocks gets a line with "Page N"
// in front of the block. One that begins inside a block gets the line at the
// exact place: in the text of a paragraph or code block the line breaks it
// there (the PDF starts the new page with that word or line), over a table
// row or a list item it sits on top of it. Only a break inside a block taller
// than a page, which pdfmake makes on its own, is drawn roughly ("approx.").

const pageLinesKey = new PluginKey<DecorationSet>("pageLines");

function lineWidget(page: number, tag: "div" | "span"): HTMLElement {
  const line = document.createElement(tag);
  line.className = tag === "div" ? "page-line" : "page-line page-line--inline";
  line.contentEditable = "false";
  line.title = i18n.t("editor.pageLineHint");

  const label = document.createElement("span");
  label.className = "page-line__label";
  label.textContent = i18n.t("editor.pageLine", { page });
  line.appendChild(label);

  return line;
}

function buildDecorations(doc: ProseMirrorNode, marks: PageLineMark[]): DecorationSet {
  const decorations: Decoration[] = [];
  const withinByNode = new Map<number, Extract<PageLineMark, { kind: "within" }>[]>();

  for (const mark of marks) {
    switch (mark.kind) {
      case "between":
      case "inline":
        decorations.push(
          Decoration.widget(mark.pos, () => lineWidget(mark.page, mark.kind === "between" ? "div" : "span"), {
            side: -1,
            key: `page-line-${mark.kind}-${mark.page}`,
            ignoreSelection: true
          })
        );
        break;
      case "before": {
        const label = i18n.t("editor.pageLine", { page: mark.page });

        decorations.push(Decoration.node(mark.pos, mark.end, { class: "page-line-before" }));
        decorations.push(
          Decoration.node(mark.labelPos, mark.labelEnd, {
            class: "page-line-label",
            "data-page-line": label,
            title: i18n.t("editor.pageLineHint")
          })
        );
        break;
      }
      case "within":
        withinByNode.set(mark.pos, [...(withinByNode.get(mark.pos) ?? []), mark]);
        break;
    }
  }

  // One marker per block: a block that spans more than two pages names
  // every page it runs onto, at the first break.
  for (const [pos, within] of withinByNode) {
    const [first] = within;

    decorations.push(
      Decoration.node(pos, first.end, {
        class: "page-line-within",
        style: `--page-line-at: ${Math.round(first.fraction * 1000) / 10}%`,
        "data-page-line": i18n.t("editor.pageLineApprox", { pages: within.map((mark) => mark.page).join(", ") }),
        title: i18n.t("editor.pageLineHint")
      })
    );
  }

  return DecorationSet.create(doc, decorations);
}

/** Shows `marks`, or removes every page line when given null. */
export function setPageLineMarks(editor: Editor, marks: PageLineMark[] | null): void {
  if (editor.isDestroyed) {
    return;
  }

  editor.view.dispatch(editor.state.tr.setMeta(pageLinesKey, { marks }).setMeta("addToHistory", false));
}

export const PageLines = Extension.create({
  name: "pageLines",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: pageLinesKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, decorations) {
            const meta = tr.getMeta(pageLinesKey) as { marks: PageLineMark[] | null } | undefined;

            if (meta) {
              return meta.marks ? buildDecorations(tr.doc, meta.marks) : DecorationSet.empty;
            }

            // Until the next layout arrives, the lines move with the text.
            return tr.docChanged ? decorations.map(tr.mapping, tr.doc) : decorations;
          }
        },
        props: {
          decorations(state) {
            return pageLinesKey.getState(state) ?? null;
          }
        }
      })
    ];
  }
});
