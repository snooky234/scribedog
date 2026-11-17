import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { BLOCK_GUTTER_BRIEF_POSITION_MS, type BlockGutterOptions } from "@/lib/editor/blockGutterOptions";
import { blockIndexAt, blockPositionOf, collectNumberedBlocks, formatBadgePosition } from "@/lib/editor/blockPosition";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

// The block gutter (issue #52): a narrow strip at the left edge of the page
// with one bar per numbered block, as tall as the block. The block the cursor
// is in is drawn in the accent colour with its number as a badge, and the
// badge can widen for a moment to show the cursor's character or the range
// of a selection. Which blocks get a number is decided in blockPosition.ts.
//
// The strip lives in a layer next to the editable element, not in it:
// anything inside ProseMirror's DOM that it did not render would be read as
// a DOM mutation, and a decoration on each block would sit at that block's own
// indent, so a nested list item's bar would move to the right. The bar
// heights are read from the rendered blocks once per frame after a change,
// which is one layout pass the browser does for the paint anyway. Only the
// optional highlight of the active block is a decoration, since it belongs
// on the block itself.

type BlockGutterMeta = boolean | "refresh";

const blockGutterKey = new PluginKey<boolean>("blockGutter");

/** Class on the editable surface while the gutter is shown; makes room for it. */
export const BLOCK_GUTTER_SURFACE_CLASS = "editor-view__surface--block-gutter";
const LAYER_CLASS = "block-gutter";
const BAR_CLASS = "block-gutter__bar";
const ACTIVE_CLASS = "block-gutter__bar--active";
const POSITION_CLASS = "block-gutter__position";
const ACTIVE_BLOCK_CLASS = "block-gutter-active";
const ACTIVE_FRAME_CLASS = "block-gutter-active--frame";
const PAPER_SURFACE_CLASS = "editor-view__surface--paper";
/** A select-all would tint the whole note; past this many blocks it tints none. */
const HIGHLIGHT_MAX_BLOCKS = 40;

/** Shows or hides the gutter; the editor decides (setting, Zen mode, staged review). */
export function setBlockGutterEnabled(editor: Editor, enabled: boolean): void {
  if (editor.isDestroyed || blockGutterKey.getState(editor.state) === enabled) {
    return;
  }

  editor.view.dispatch(
    editor.state.tr.setMeta(blockGutterKey, enabled satisfies BlockGutterMeta).setMeta("addToHistory", false)
  );
}

function options(): BlockGutterOptions {
  return useEditorSettingsStore.getState().blockGutterOptions;
}

function activeRange(state: EditorState): [number, number] {
  const blocks = collectNumberedBlocks(state.doc);
  const { from, to, empty } = state.selection;
  const first = Math.max(0, blockIndexAt(blocks, from));
  const last = empty ? first : Math.max(first, blockIndexAt(blocks, Math.max(from, to - 1)));
  return [first, last];
}

function activeBlockDecorations(state: EditorState): DecorationSet | null {
  if (blockGutterKey.getState(state) !== true || !options().highlightActive) {
    return null;
  }

  const blocks = collectNumberedBlocks(state.doc);

  if (blocks.length === 0) {
    return null;
  }

  const [first, last] = activeRange(state);

  if (last - first + 1 > HIGHLIGHT_MAX_BLOCKS) {
    return null;
  }

  const decorations: Decoration[] = [];

  for (let index = first; index <= last; index += 1) {
    const block = blocks[index];
    const node = state.doc.nodeAt(block.pos);
    // A tint behind code or a table fights with their own background; they
    // get a frame instead.
    const framed = node?.type.spec.code === true || node?.type.spec.tableRole === "table" || !node?.isTextblock;
    decorations.push(
      Decoration.node(block.pos, block.end, {
        class: framed ? `${ACTIVE_BLOCK_CLASS} ${ACTIVE_FRAME_CLASS}` : ACTIVE_BLOCK_CLASS
      })
    );
  }

  return DecorationSet.create(state.doc, decorations);
}

class BlockGutterView {
  private layer: HTMLDivElement | null = null;
  private position: HTMLDivElement | null = null;
  private bars: HTMLDivElement[] = [];
  private frame = 0;
  private hideTimer: number | undefined;
  /** The position is (re)shown on the next render: the cursor moved. */
  private revealPosition = false;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribe: () => void;

  constructor(private view: EditorView) {
    // An option change has no transaction of its own: the decorations need
    // one to be read again, the layer only a render.
    this.unsubscribe = useEditorSettingsStore.subscribe((state, previous) => {
      if (state.blockGutterOptions !== previous.blockGutterOptions && !this.view.isDestroyed) {
        this.view.dispatch(
          this.view.state.tr.setMeta(blockGutterKey, "refresh" satisfies BlockGutterMeta).setMeta("addToHistory", false)
        );
        this.schedule();
      }
    });
    this.sync();
  }

  update(view: EditorView, previous: EditorState): void {
    this.view = view;
    const enabled = this.sync();

    if (enabled && (view.state.doc !== previous.doc || view.state.selection !== previous.selection)) {
      this.revealPosition = this.revealPosition || view.state.selection !== previous.selection;
      this.schedule();
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.unmount();
  }

  /** Mounts or unmounts the layer to match the plugin state; returns whether it is shown. */
  private sync(): boolean {
    const enabled = blockGutterKey.getState(this.view.state) === true;

    if (enabled && !this.layer) {
      this.mount();
    } else if (!enabled && this.layer) {
      this.unmount();
    }

    return enabled;
  }

  private mount(): void {
    const parent = this.view.dom.parentElement;

    if (!parent) {
      return;
    }

    const layer = document.createElement("div");
    layer.className = LAYER_CLASS;
    layer.setAttribute("aria-hidden", "true");
    layer.addEventListener("mousedown", this.handleMouseDown);

    const position = document.createElement("div");
    position.className = POSITION_CLASS;
    position.append(document.createElement("span"), document.createElement("span"));
    layer.appendChild(position);

    parent.appendChild(layer);
    this.layer = layer;
    this.position = position;
    this.view.dom.classList.add(BLOCK_GUTTER_SURFACE_CLASS);

    // Covers everything that moves a block without a transaction: a wider
    // window re-wrapping the text, an image finishing to load, a font swap.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.schedule());
      this.resizeObserver.observe(this.view.dom);
    }

    this.schedule();
  }

  private unmount(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }

    window.clearTimeout(this.hideTimer);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.layer?.removeEventListener("mousedown", this.handleMouseDown);
    this.layer?.remove();
    this.layer = null;
    this.position = null;
    this.bars = [];
    this.view.dom.classList.remove(BLOCK_GUTTER_SURFACE_CLASS);
  }

  private schedule(): void {
    if (this.frame || !this.layer) {
      return;
    }

    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const layer = this.layer;
    const origin = layer?.parentElement?.getBoundingClientRect();

    if (!layer || !origin || this.view.isDestroyed) {
      return;
    }

    const { state } = this.view;
    const settings = options();
    const blocks = collectNumberedBlocks(state.doc);
    const [firstActive, lastActive] = activeRange(state);
    const surface = this.view.dom.getBoundingClientRect();

    // Over the paper surface the strip belongs to the page's light palette,
    // not to the dark UI around it.
    layer.classList.toggle("paper-palette", this.view.dom.classList.contains(PAPER_SURFACE_CLASS));
    layer.classList.toggle("block-gutter--all-numbers", settings.numbersOnAll);
    layer.style.left = `${surface.left - origin.left}px`;
    layer.style.top = `${surface.top - origin.top}px`;
    layer.style.height = `${surface.height}px`;

    // Reads first, writes after: one layout for the whole pass.
    const boxes = blocks.map((block) => {
      const element = this.view.nodeDOM(block.pos);

      if (!(element instanceof HTMLElement)) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      // A block inside a collapsed <details> has no box.
      return rect.height === 0 && rect.width === 0 ? null : { top: rect.top - surface.top, height: rect.height };
    });

    while (this.bars.length < blocks.length) {
      const bar = document.createElement("div");
      bar.className = BAR_CLASS;
      layer.insertBefore(bar, this.position);
      this.bars.push(bar);
    }

    while (this.bars.length > blocks.length) {
      this.bars.pop()?.remove();
    }

    boxes.forEach((box, index) => {
      const bar = this.bars[index];
      const number = String(index + 1);

      if (bar.dataset.blockNumber !== number) {
        bar.dataset.blockNumber = number;
      }

      const display = box ? "" : "none";
      if (bar.style.display !== display) {
        bar.style.display = display;
      }

      if (box) {
        const top = `${box.top}px`;
        const height = `${box.height}px`;
        if (bar.style.top !== top) {
          bar.style.top = top;
        }
        if (bar.style.height !== height) {
          bar.style.height = height;
        }
      }

      bar.classList.toggle(ACTIVE_CLASS, index >= firstActive && index <= lastActive);
    });

    this.renderPosition(settings, boxes[firstActive] ?? null, firstActive);
  }

  // The widened badge: the active block's number again, then the position.
  // It covers the bar's own badge exactly, so it reads as that badge growing
  // to the right.
  private renderPosition(
    settings: BlockGutterOptions,
    box: { top: number; height: number } | null,
    activeIndex: number
  ): void {
    const element = this.position;

    if (!element) {
      return;
    }

    const { from, to } = this.view.state.selection;
    const position = blockPositionOf(this.view.state.doc, from, to);
    const text = position ? formatBadgePosition(position) : null;
    const reveal = this.revealPosition;
    this.revealPosition = false;

    if (settings.cursorPosition === "off" || !box || !text || !this.view.hasFocus()) {
      element.classList.remove(`${POSITION_CLASS}--visible`);
      return;
    }

    const [numberPart, positionPart] = element.children as unknown as [HTMLSpanElement, HTMLSpanElement];
    numberPart.textContent = String(activeIndex + 1);
    positionPart.textContent = text;
    element.style.top = `${box.top}px`;

    if (settings.cursorPosition === "always") {
      window.clearTimeout(this.hideTimer);
      element.classList.add(`${POSITION_CLASS}--visible`);
      return;
    }

    if (reveal) {
      element.classList.add(`${POSITION_CLASS}--visible`);
      window.clearTimeout(this.hideTimer);
      this.hideTimer = window.setTimeout(() => {
        this.position?.classList.remove(`${POSITION_CLASS}--visible`);
      }, BLOCK_GUTTER_BRIEF_POSITION_MS);
    }
  }

  // A click on a bar puts the cursor at the start of its block, so the
  // gutter can be used to step to a block someone named.
  private handleMouseDown = (event: MouseEvent): void => {
    const target = event.target;

    if (!(target instanceof HTMLElement) || !target.classList.contains(BAR_CLASS)) {
      return;
    }

    const index = Number.parseInt(target.dataset.blockNumber ?? "", 10) - 1;
    const block = collectNumberedBlocks(this.view.state.doc)[index];

    if (!block) {
      return;
    }

    event.preventDefault();
    const { state } = this.view;
    const selection = TextSelection.near(state.doc.resolve(Math.min(block.pos + 1, state.doc.content.size)));
    this.view.dispatch(state.tr.setSelection(selection).scrollIntoView());
    this.view.focus();
  };
}

export const BlockGutter = Extension.create({
  name: "blockGutter",

  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: blockGutterKey,
        state: {
          init: () => false,
          apply(tr, value) {
            const meta = tr.getMeta(blockGutterKey) as BlockGutterMeta | undefined;
            return typeof meta === "boolean" ? meta : value;
          }
        },
        props: {
          decorations: (state) => activeBlockDecorations(state)
        },
        view: (view) => new BlockGutterView(view)
      })
    ];
  }
});
