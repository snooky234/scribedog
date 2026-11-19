import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// A cycle with blockGutter.ts (it reads the marks for its bars), harmless
// because neither touches the other's exports before they are used.
import { BLOCK_GUTTER_SURFACE_CLASS } from "@/lib/editor/blockGutter";
import { blockIndexAt, collectNumberedBlocks } from "@/lib/editor/blockPosition";
import {
  nextPlacemarkBlock,
  normalizePlacemarkComment,
  placemarkQuote,
  resolvePlacemarks,
  type PlacemarkAnchor
} from "@/lib/placemarks";
import { usePlacemarksStore } from "@/store/usePlacemarksStore";

// Placemarks in the open note (issue #91). While the note is open a mark is a
// document position (the start of its block) mapped through every
// transaction, so it stays on its block however the text around it changes.
// Only when the note is opened is it resolved from the stored form (block
// number plus the start of the text, lib/placemarks.ts), and every change is
// handed back to usePlacemarksStore in that form.
//
// The plugin knows which note its marks belong to (`file`) and reports
// nothing while that is null. That is what keeps one note's marks from being
// written under another's name: switching notes replaces only the part of the
// document that differs (replaceDocumentKeepingSelection), so mapped
// positions would survive the switch and land in the new note. The editor
// clears the plugin before the switch and loads the new note's marks after.

export type PlacemarkFile = {
  vaultPath: string;
  relativePath: string;
};

type PlacemarkEntry = {
  /** Document position right before the marked block. */
  pos: number;
  comment: string;
};

type PlacemarkPluginState = {
  file: PlacemarkFile | null;
  marks: PlacemarkEntry[];
};

type PlacemarkMeta =
  | { type: "load"; file: PlacemarkFile; anchors: PlacemarkAnchor[] }
  | { type: "clear" }
  | { type: "toggle"; pos: number }
  | { type: "comment"; pos: number; comment: string }
  | { type: "remove"; pos: number };

export type PlacemarkInfo = {
  /** Document position right before the marked block. */
  pos: number;
  /** 1-based, as the gutter numbers it. */
  blockNumber: number;
  quote: string;
  comment: string;
};

const placemarkKey = new PluginKey<PlacemarkPluginState>("placemarks");

const MARGIN_LAYER_CLASS = "placemark-margin";
const MARGIN_STROKE_CLASS = "placemark-margin__stroke";

const EMPTY_STATE: PlacemarkPluginState = { file: null, marks: [] };

function blockText(doc: ProseMirrorNode, pos: number): string {
  return placemarkQuote(doc.nodeAt(pos)?.textContent ?? "");
}

/** The start of the block containing `pos`, or null in an empty document. */
function blockStartAt(doc: ProseMirrorNode, pos: number): number | null {
  const blocks = collectNumberedBlocks(doc);

  if (blocks.length === 0) {
    return null;
  }

  return blocks[Math.max(0, blockIndexAt(blocks, pos))].pos;
}

/** Sorted by position, one mark per block; a merged pair keeps a comment. */
function normalizeMarks(marks: PlacemarkEntry[]): PlacemarkEntry[] {
  const byPos = new Map<number, PlacemarkEntry>();

  for (const mark of marks) {
    const existing = byPos.get(mark.pos);

    if (!existing) {
      byPos.set(mark.pos, { ...mark });
    } else if (!existing.comment && mark.comment) {
      existing.comment = mark.comment;
    }
  }

  return [...byPos.values()].sort((a, b) => a.pos - b.pos);
}

function mapMarks(marks: PlacemarkEntry[], tr: Transaction): PlacemarkEntry[] {
  const mapped: PlacemarkEntry[] = [];

  for (const mark of marks) {
    // A textblock's mark follows the start of its content, not the block's
    // front edge: Enter at the very start of a marked paragraph splits off an
    // empty one above, and the mark belongs with the text that moved down.
    // assoc 1 also pushes it past a block inserted right before. A leaf
    // (image, rule) has no inside, so its own position is mapped.
    const node = tr.before.nodeAt(mark.pos);
    const anchor = node && !node.isLeaf && !node.isAtom ? mark.pos + 1 : mark.pos;
    const pos = blockStartAt(tr.doc, tr.mapping.map(anchor, 1));

    if (pos !== null) {
      mapped.push({ pos, comment: mark.comment });
    }
  }

  return normalizeMarks(mapped);
}

function applyMeta(state: PlacemarkPluginState, meta: PlacemarkMeta, doc: ProseMirrorNode): PlacemarkPluginState {
  switch (meta.type) {
    case "load": {
      const blocks = collectNumberedBlocks(doc);
      const quotes = blocks.map((block) => blockText(doc, block.pos));
      const marks = resolvePlacemarks(quotes, meta.anchors).map((mark) => ({
        pos: blocks[mark.block].pos,
        comment: mark.comment
      }));

      return { file: meta.file, marks };
    }
    case "clear":
      return EMPTY_STATE;
    case "toggle": {
      const pos = blockStartAt(doc, meta.pos);

      if (pos === null) {
        return state;
      }

      const exists = state.marks.some((mark) => mark.pos === pos);

      return {
        ...state,
        marks: exists
          ? state.marks.filter((mark) => mark.pos !== pos)
          : normalizeMarks([...state.marks, { pos, comment: "" }])
      };
    }
    case "comment":
      return {
        ...state,
        marks: state.marks.map((mark) =>
          mark.pos === meta.pos ? { ...mark, comment: normalizePlacemarkComment(meta.comment) } : mark
        )
      };
    case "remove":
      return { ...state, marks: state.marks.filter((mark) => mark.pos !== meta.pos) };
    default:
      return state;
  }
}

function anchorsOf(state: PlacemarkPluginState, doc: ProseMirrorNode): PlacemarkAnchor[] {
  const blocks = collectNumberedBlocks(doc);

  return state.marks.map((mark) => {
    const anchor: PlacemarkAnchor = {
      block: Math.max(0, blockIndexAt(blocks, mark.pos)),
      quote: blockText(doc, mark.pos)
    };

    if (mark.comment) {
      anchor.comment = mark.comment;
    }

    return anchor;
  });
}

function getPluginState(state: EditorState): PlacemarkPluginState {
  return placemarkKey.getState(state) ?? EMPTY_STATE;
}

function dispatchMeta(editor: Editor, meta: PlacemarkMeta): void {
  if (editor.isDestroyed) {
    return;
  }

  editor.view.dispatch(editor.state.tr.setMeta(placemarkKey, meta).setMeta("addToHistory", false));
}

/** Puts a note's stored marks into the editor; call after its content is in place. */
export function loadPlacemarks(editor: Editor, file: PlacemarkFile, anchors: PlacemarkAnchor[]): void {
  dispatchMeta(editor, { type: "load", file, anchors });
}

/** Detaches the marks from the note, before another note's content comes in. */
export function clearPlacemarks(editor: Editor): void {
  if (!editor.isDestroyed && getPluginState(editor.state) !== EMPTY_STATE) {
    dispatchMeta(editor, { type: "clear" });
  }
}

/** Whether the editor holds a note marks can be set in. */
export function placemarksAvailable(state: EditorState): boolean {
  return getPluginState(state).file !== null;
}

/** Sets or removes the mark on the block containing `pos`. */
export function togglePlacemarkAt(view: EditorView, pos: number): boolean {
  if (!placemarksAvailable(view.state)) {
    return false;
  }

  view.dispatch(view.state.tr.setMeta(placemarkKey, { type: "toggle", pos }).setMeta("addToHistory", false));
  return true;
}

/** Sets or removes the mark on the block the cursor is in. */
export function togglePlacemarkAtSelection(editor: Editor): boolean {
  return !editor.isDestroyed && togglePlacemarkAt(editor.view, editor.state.selection.from);
}

export function setPlacemarkComment(editor: Editor, pos: number, comment: string): void {
  dispatchMeta(editor, { type: "comment", pos, comment });
}

export function removePlacemark(editor: Editor, pos: number): void {
  dispatchMeta(editor, { type: "remove", pos });
}

/** Marked block index -> its comment ("" without one), for the gutter's bars and their tooltips. */
export function placemarkCommentsByBlock(state: EditorState): Map<number, string> {
  const { marks } = getPluginState(state);

  if (marks.length === 0) {
    return new Map();
  }

  const blocks = collectNumberedBlocks(state.doc);
  return new Map(marks.map((mark) => [blockIndexAt(blocks, mark.pos), mark.comment]));
}

/** Whether the marks differ between two states, so a view only redraws when they do. */
export function placemarksChanged(state: EditorState, previous: EditorState): boolean {
  return getPluginState(state) !== getPluginState(previous);
}

export function listPlacemarks(state: EditorState): PlacemarkInfo[] {
  const { marks } = getPluginState(state);
  const blocks = collectNumberedBlocks(state.doc);

  return marks.map((mark) => ({
    pos: mark.pos,
    blockNumber: blockIndexAt(blocks, mark.pos) + 1,
    quote: blockText(state.doc, mark.pos),
    comment: mark.comment
  }));
}

/**
 * Puts the cursor at the start of a marked block and scrolls it into the
 * middle of the view: a mark is somewhere to continue, so it gets context
 * above it rather than sitting at the very top.
 */
export function revealPlacemark(editor: Editor, pos: number, focus: boolean): void {
  if (editor.isDestroyed || pos > editor.state.doc.content.size) {
    return;
  }

  const { state } = editor;
  const selection = TextSelection.near(state.doc.resolve(Math.min(pos + 1, state.doc.content.size)));
  editor.view.dispatch(state.tr.setSelection(selection));

  const element = editor.view.nodeDOM(pos);

  if (element instanceof HTMLElement) {
    element.scrollIntoView({ block: "center" });
  }

  if (focus) {
    editor.view.focus();
  }
}

/** Jumps to the next or previous mark from the cursor, wrapping around. */
export function jumpToPlacemark(editor: Editor, direction: 1 | -1): boolean {
  if (editor.isDestroyed) {
    return false;
  }

  const { marks } = getPluginState(editor.state);
  const blocks = collectNumberedBlocks(editor.state.doc);
  const markedBlocks = marks.map((mark) => blockIndexAt(blocks, mark.pos));
  const current = blockIndexAt(blocks, editor.state.selection.from);
  const target = nextPlacemarkBlock(markedBlocks, current, direction);

  if (target === null) {
    return false;
  }

  revealPlacemark(editor, blocks[target].pos, true);
  return true;
}

/**
 * The marks when the block gutter is off: one short amber stroke per marked
 * block in the surface's left padding, as tall as the block. Drawn in a layer
 * next to the editable element for the gutter's reasons (blockGutter.ts):
 * nothing inside ProseMirror's DOM that it did not render, and one column
 * for every block regardless of its indent. With the gutter on, its bars show
 * the marks and this layer stays empty.
 */
class PlacemarkMarginView {
  private layer: HTMLDivElement | null = null;
  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;
  /** Whether the gutter was on at the last render, so its switch triggers one. */
  private renderedWithGutter: boolean | null = null;

  constructor(private view: EditorView) {
    this.schedule();
  }

  update(view: EditorView, previous: EditorState): void {
    this.view = view;

    // The gutter's switch is a transaction too, so a plain comparison of the
    // surface class on every update catches it.
    if (
      view.state.doc !== previous.doc ||
      placemarksChanged(view.state, previous) ||
      this.gutterShown() !== this.renderedWithGutter
    ) {
      this.schedule();
    }
  }

  destroy(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
    }

    this.resizeObserver?.disconnect();
    this.layer?.remove();
    this.layer = null;
  }

  private gutterShown(): boolean {
    return this.view.dom.classList.contains(BLOCK_GUTTER_SURFACE_CLASS);
  }

  private schedule(): void {
    if (this.frame || typeof requestAnimationFrame === "undefined") {
      return;
    }

    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private ensureLayer(): HTMLDivElement | null {
    if (this.layer?.isConnected) {
      return this.layer;
    }

    const parent = this.view.dom.parentElement;

    if (!parent) {
      return null;
    }

    const layer = document.createElement("div");
    layer.className = MARGIN_LAYER_CLASS;
    layer.setAttribute("aria-hidden", "true");
    parent.appendChild(layer);
    this.layer = layer;

    // Re-wrapping text, a loaded image or a font swap move blocks without a
    // transaction.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.schedule());
      this.resizeObserver.observe(this.view.dom);
    }

    return layer;
  }

  private render(): void {
    if (this.view.isDestroyed) {
      return;
    }

    const { marks } = getPluginState(this.view.state);
    const gutter = this.gutterShown();
    this.renderedWithGutter = gutter;

    if (marks.length === 0 || gutter) {
      this.layer?.replaceChildren();
      return;
    }

    const layer = this.ensureLayer();
    const origin = layer?.parentElement?.getBoundingClientRect();

    if (!layer || !origin) {
      return;
    }

    const surface = this.view.dom.getBoundingClientRect();
    const padding = Number.parseFloat(getComputedStyle(this.view.dom).paddingLeft) || 0;
    // Centred in the padding, so the stroke keeps its distance from the text.
    const left = surface.left - origin.left + Math.max(2, padding / 2 - 1.5);

    const strokes = marks.flatMap((mark) => {
      const element = this.view.nodeDOM(mark.pos);

      if (!(element instanceof HTMLElement)) {
        return [];
      }

      const rect = element.getBoundingClientRect();

      if (rect.width === 0 && rect.height === 0) {
        return [];
      }

      const stroke = document.createElement("div");
      stroke.className = MARGIN_STROKE_CLASS;
      stroke.style.left = `${left}px`;
      stroke.style.top = `${rect.top - origin.top}px`;
      stroke.style.height = `${rect.height}px`;
      return [stroke];
    });

    layer.replaceChildren(...strokes);
  }
}

export const Placemarks = Extension.create({
  name: "placemarks",

  addProseMirrorPlugins() {
    return [
      new Plugin<PlacemarkPluginState>({
        key: placemarkKey,
        state: {
          init: () => EMPTY_STATE,
          apply(tr, value) {
            const meta = tr.getMeta(placemarkKey) as PlacemarkMeta | undefined;
            const mapped = tr.docChanged && value.marks.length > 0 ? { ...value, marks: mapMarks(value.marks, tr) } : value;
            return meta ? applyMeta(mapped, meta, tr.doc) : mapped;
          }
        },
        view: (editorView) => {
          const margin = new PlacemarkMarginView(editorView);

          return {
            // Reports every change in the stored form; the store compares and
            // writes only what actually differs, so typing in an unmarked
            // block costs one comparison.
            update(view, previous) {
              margin.update(view, previous);
              const current = getPluginState(view.state);

              if (!current.file || (current === getPluginState(previous) && view.state.doc === previous.doc)) {
                return;
              }

              usePlacemarksStore
                .getState()
                .setFileAnchors(current.file.vaultPath, current.file.relativePath, anchorsOf(current, view.state.doc));
            },
            destroy() {
              margin.destroy();
            }
          };
        }
      })
    ];
  }
});
