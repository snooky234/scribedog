import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import i18n from "@/i18n";
import {
  currentTableCell,
  hasMergedCells,
  moveTableLine,
  moveTopLevelTable,
  type TableCellContext
} from "@/lib/editor/tableMove";

// Drag grips at the edge of the table the caret is in: one above the current
// column, one left of the current row, one in the corner for the whole table.
// They appear with the caret rather than on hover, because a phone has no
// hover. Dragging moves the line (tableMove.ts, one undo step), a tap selects
// it, so a row can be picked and deleted without a mouse.
//
// Pointer events rather than HTML5 drag and drop: the latter never starts on
// a touch screen. `touch-action: none` on the grips (editor-content.css) keeps
// the finger from scrolling the page instead.
//
// The grips live in one widget decoration placed right before the table, the
// same way the outline highlight does (outlineHighlight.ts): widget DOM is
// what ProseMirror's mutation observer ignores, and the surface is the
// containing block the grips are positioned in. Positioned there rather than
// inside the .tableWrapper, they are not clipped by its horizontal scroll.
//
// Rules shared with the keyboard: the header row does not move (no row grip
// there), a table with merged cells only offers the table grip, and only a
// table that is a direct child of the document can be dragged as a whole
// (a tap still selects a nested one). A read-only editor, which is what a
// staged change's review is, shows no grips at all.

type GripKind = "row" | "column" | "table";

type GripTarget = {
  tablePos: number;
  tableDepth: number;
  /** Null when the table itself is selected. */
  cell: TableCellContext | null;
  /** Rows and columns can move: no merged cells. */
  lines: boolean;
};

type Point = { x: number; y: number };

const tableGripsKey = new PluginKey("tableGrips");
const GRIPS_CLASS = "table-grips";
// A tap that wanders a few pixels is still a tap.
const DRAG_THRESHOLD_PX = 5;
// Gap between a grip and the table edge.
const GRIP_GAP_PX = 3;
// Distance from a scroll edge at which a drag starts scrolling, and the
// fastest step per frame.
const AUTOSCROLL_EDGE_PX = 40;
const AUTOSCROLL_MAX_STEP_PX = 14;

const LABEL_KEYS: Record<GripKind, string> = {
  row: "tableMenu.gripRow",
  column: "tableMenu.gripColumn",
  table: "tableMenu.gripTable"
};

// Six dots, the usual "this can be dragged" mark; the column grip lies on its
// side. currentColor, so the colour comes from the stylesheet's tokens.
const DOTS_VERTICAL =
  '<svg viewBox="0 0 6 10" aria-hidden="true"><circle cx="1.25" cy="1.25" r="1.1"/><circle cx="4.75" cy="1.25" r="1.1"/><circle cx="1.25" cy="5" r="1.1"/><circle cx="4.75" cy="5" r="1.1"/><circle cx="1.25" cy="8.75" r="1.1"/><circle cx="4.75" cy="8.75" r="1.1"/></svg>';
const DOTS_HORIZONTAL =
  '<svg viewBox="0 0 10 6" aria-hidden="true"><circle cx="1.25" cy="1.25" r="1.1"/><circle cx="5" cy="1.25" r="1.1"/><circle cx="8.75" cy="1.25" r="1.1"/><circle cx="1.25" cy="4.75" r="1.1"/><circle cx="5" cy="4.75" r="1.1"/><circle cx="8.75" cy="4.75" r="1.1"/></svg>';
const DOTS_GRID =
  '<svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="1.25" cy="1.25" r="1.1"/><circle cx="5" cy="1.25" r="1.1"/><circle cx="8.75" cy="1.25" r="1.1"/><circle cx="1.25" cy="5" r="1.1"/><circle cx="5" cy="5" r="1.1"/><circle cx="8.75" cy="5" r="1.1"/><circle cx="1.25" cy="8.75" r="1.1"/><circle cx="5" cy="8.75" r="1.1"/><circle cx="8.75" cy="8.75" r="1.1"/></svg>';

function gripTarget(state: EditorState): GripTarget | null {
  const { selection } = state;

  if (selection instanceof NodeSelection && selection.node.type.name === "table") {
    return { tablePos: selection.from, tableDepth: selection.$from.depth + 1, cell: null, lines: false };
  }

  const cell = currentTableCell(state);

  if (!cell) {
    return null;
  }

  return { tablePos: cell.tablePos, tableDepth: cell.tableDepth, cell, lines: !hasMergedCells(cell.table) };
}

type TableElements = { wrapper: HTMLElement; table: HTMLTableElement };

// The table's DOM: the resizable table view wraps it in a .tableWrapper,
// which is also what scrolls sideways.
function tableElements(view: EditorView, tablePos: number): TableElements | null {
  const dom = view.nodeDOM(tablePos);

  if (dom instanceof HTMLTableElement) {
    return { wrapper: dom, table: dom };
  }

  if (!(dom instanceof HTMLElement)) {
    return null;
  }

  const table = dom.querySelector("table");
  return table ? { wrapper: dom, table } : null;
}

function scrollContainer(view: EditorView): HTMLElement | null {
  return view.dom.closest<HTMLElement>(".editor-view__scroll");
}

// Scroll speed grows towards the edge; zero outside the edge zone.
function edgeStep(position: number, start: number, end: number): number {
  if (position < start + AUTOSCROLL_EDGE_PX) {
    return -Math.ceil(((start + AUTOSCROLL_EDGE_PX - position) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_STEP_PX);
  }

  if (position > end - AUTOSCROLL_EDGE_PX) {
    return Math.ceil(((position - end + AUTOSCROLL_EDGE_PX) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_STEP_PX);
  }

  return 0;
}

class TableGripsView {
  readonly root: HTMLElement;
  private readonly grips: Record<GripKind, HTMLButtonElement>;
  private readonly indicator: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private cancelDrag: (() => void) | null = null;

  constructor(private view: EditorView) {
    this.root = document.createElement("div");
    this.root.className = GRIPS_CLASS;
    this.root.contentEditable = "false";
    this.root.hidden = true;

    this.grips = {
      table: this.createGrip("table", DOTS_GRID),
      column: this.createGrip("column", DOTS_HORIZONTAL),
      row: this.createGrip("row", DOTS_VERTICAL)
    };

    this.indicator = document.createElement("div");
    this.indicator.className = "table-grip-indicator";
    this.indicator.hidden = true;
    this.root.append(this.indicator);

    // Layout that moves the table without a transaction: a resized window
    // or panel, a zoom step, a font change.
    this.resizeObserver = new ResizeObserver(() => this.place());
    this.resizeObserver.observe(view.dom);
    // Scrolling a wide table sideways moves the column under its grip.
    // Scroll events do not bubble, so the listener captures.
    view.dom.addEventListener("scroll", this.onScroll, true);
  }

  private createGrip(kind: GripKind, icon: string): HTMLButtonElement {
    const grip = document.createElement("button");
    grip.type = "button";
    grip.tabIndex = -1;
    grip.className = `table-grip table-grip--${kind}`;
    grip.innerHTML = icon;
    grip.hidden = true;
    grip.addEventListener("pointerdown", (event) => this.startDrag(kind, event));
    // The pointerdown already did the work; a click must not reach the editor.
    grip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    this.root.append(grip);

    return grip;
  }

  private onScroll = (event: Event) => {
    if (event.target instanceof HTMLElement && event.target.classList.contains("tableWrapper")) {
      this.place();
    }
  };

  update(view: EditorView) {
    this.view = view;
    this.place();
  }

  destroy() {
    this.cancelDrag?.();
    this.resizeObserver.disconnect();
    this.view.dom.removeEventListener("scroll", this.onScroll, true);
    this.root.remove();
  }

  // Viewport coordinates translated into the surface's padding box, which is
  // the containing block of the grips (view.dom is position: relative).
  private origin(): Point {
    const surface = this.view.dom.getBoundingClientRect();
    return { x: surface.left + this.view.dom.clientLeft, y: surface.top + this.view.dom.clientTop };
  }

  place() {
    const target = this.view.editable ? gripTarget(this.view.state) : null;
    const elements = target ? tableElements(this.view, target.tablePos) : null;

    if (!target || !elements || !this.root.isConnected) {
      this.root.hidden = true;
      return;
    }

    this.root.hidden = false;
    const origin = this.origin();
    const wrapperRect = elements.wrapper.getBoundingClientRect();
    const tableRect = elements.table.getBoundingClientRect();
    const top = Math.max(tableRect.top, wrapperRect.top);

    for (const kind of Object.keys(this.grips) as GripKind[]) {
      const label = i18n.t(LABEL_KEYS[kind]);
      const grip = this.grips[kind];

      if (grip.title !== label) {
        grip.title = label;
        grip.setAttribute("aria-label", label);
      }
    }

    const tableGrip = this.grips.table;
    tableGrip.hidden = false;
    tableGrip.classList.toggle("table-grip--selected", target.cell === null);
    tableGrip.style.left = `${wrapperRect.left - origin.x - tableGrip.offsetWidth - GRIP_GAP_PX}px`;
    tableGrip.style.top = `${top - origin.y - tableGrip.offsetHeight - GRIP_GAP_PX}px`;

    const cellDom = target.cell && target.lines ? this.view.nodeDOM(target.cell.cellPos) : null;

    if (!(cellDom instanceof HTMLElement) || !target.cell) {
      this.grips.row.hidden = true;
      this.grips.column.hidden = true;
      return;
    }

    const cellRect = cellDom.getBoundingClientRect();
    const columnGrip = this.grips.column;
    const centerX = cellRect.left + cellRect.width / 2;
    // A column scrolled out of the wrapper has no grip to show.
    columnGrip.hidden = centerX < wrapperRect.left || centerX > wrapperRect.right;
    columnGrip.style.left = `${centerX - origin.x - columnGrip.offsetWidth / 2}px`;
    columnGrip.style.top = `${top - origin.y - columnGrip.offsetHeight - GRIP_GAP_PX}px`;

    const rowGrip = this.grips.row;
    const rowRect = (cellDom.parentElement ?? cellDom).getBoundingClientRect();
    rowGrip.hidden = target.cell.row === 0;
    rowGrip.style.left = `${wrapperRect.left - origin.x - rowGrip.offsetWidth - GRIP_GAP_PX}px`;
    rowGrip.style.top = `${rowRect.top + rowRect.height / 2 - origin.y - rowGrip.offsetHeight / 2}px`;
  }

  private startDrag(kind: GripKind, event: PointerEvent) {
    if (event.button !== 0 || !this.view.editable) {
      return;
    }

    // Keeps the caret (and on a phone the keyboard state) where it is.
    event.preventDefault();
    event.stopPropagation();
    this.cancelDrag?.();

    const target = gripTarget(this.view.state);

    if (!target || (kind !== "table" && (!target.cell || !target.lines))) {
      return;
    }

    const grip = event.currentTarget as HTMLElement;
    const pointerId = event.pointerId;
    const start: Point = { x: event.clientX, y: event.clientY };
    let last = start;
    let dragging = false;
    let drop: number | null = null;
    let frame = 0;

    const from =
      kind === "row"
        ? target.cell!.row
        : kind === "column"
          ? target.cell!.column
          : this.view.state.doc.resolve(target.tablePos).index(0);
    // Only a top-level table can be dragged as a whole; a nested one is
    // tap-only.
    const canDrag = kind !== "table" || target.tableDepth === 1;

    const tick = () => {
      this.autoscroll(kind, target, last);
      drop = this.showDrop(kind, target, from, last);
      frame = requestAnimationFrame(tick);
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }

      last = { x: moveEvent.clientX, y: moveEvent.clientY };

      if (dragging || !canDrag || Math.hypot(last.x - start.x, last.y - start.y) < DRAG_THRESHOLD_PX) {
        return;
      }

      dragging = true;
      this.root.classList.add("table-grips--dragging");
      grip.classList.add("table-grip--active");
      frame = requestAnimationFrame(tick);
    };

    const finish = (commit: boolean) => {
      cancelAnimationFrame(frame);
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);

      if (grip.hasPointerCapture(pointerId)) {
        grip.releasePointerCapture(pointerId);
      }

      this.root.classList.remove("table-grips--dragging");
      grip.classList.remove("table-grip--active");
      this.indicator.hidden = true;
      this.cancelDrag = null;

      if (!commit) {
        return;
      }

      if (!dragging) {
        this.select(kind, target);
        return;
      }

      if (drop === null) {
        return;
      }

      const { state } = this.view;
      const tr =
        kind === "table"
          ? moveTopLevelTable(state, target.tablePos, drop)
          : moveTableLine(state, kind, from, drop);

      if (tr) {
        this.view.dispatch(tr);
      }
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === pointerId) {
        // The drop position under the finger where it was lifted, not where
        // the last animation frame saw it.
        if (dragging) {
          last = { x: upEvent.clientX, y: upEvent.clientY };
          drop = this.showDrop(kind, target, from, last);
        }

        finish(true);
      }
    };

    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerId) {
        finish(false);
      }
    };

    // Escape drops the drag without moving anything.
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        finish(false);
      }
    };

    grip.setPointerCapture(pointerId);
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    this.cancelDrag = () => finish(false);
  }

  // A tap selects what the grip stands for.
  private select(kind: GripKind, target: GripTarget) {
    const { state } = this.view;
    let selection;

    if (kind === "table") {
      selection = NodeSelection.create(state.doc, target.tablePos);
    } else {
      const $cell = state.doc.resolve(target.cell!.cellPos);
      selection = kind === "row" ? CellSelection.rowSelection($cell) : CellSelection.colSelection($cell);
    }

    this.view.dispatch(state.tr.setSelection(selection));
  }

  private autoscroll(kind: GripKind, target: GripTarget, point: Point) {
    if (kind === "column") {
      const elements = tableElements(this.view, target.tablePos);

      if (elements && elements.wrapper !== elements.table) {
        const rect = elements.wrapper.getBoundingClientRect();
        elements.wrapper.scrollLeft += edgeStep(point.x, rect.left, rect.right);
      }

      return;
    }

    const scroller = scrollContainer(this.view);

    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      scroller.scrollTop += edgeStep(point.y, rect.top, rect.bottom);
    }
  }

  // Works out where the dragged line would land and draws the insertion line
  // there. Returns the drop index, or null when the line would stay put.
  private showDrop(kind: GripKind, target: GripTarget, from: number, point: Point): number | null {
    const drop =
      kind === "table" ? this.tableDrop(from, point) : this.lineDrop(kind, target, from, point);

    this.indicator.hidden = drop === null;
    return drop;
  }

  private lineDrop(kind: "row" | "column", target: GripTarget, from: number, point: Point): number | null {
    const elements = tableElements(this.view, target.tablePos);

    if (!elements) {
      return null;
    }

    const rows = Array.from(elements.table.rows);
    const lines = kind === "row" ? rows : Array.from(rows[0]?.cells ?? []);

    if (lines.length === 0) {
      return null;
    }

    const rects = lines.map((line) => line.getBoundingClientRect());
    const position = kind === "row" ? point.y : point.x;
    let index = rects.findIndex((rect) => position < (kind === "row" ? rect.bottom : rect.right));

    if (index === -1) {
      index = rects.length - 1;
    }

    // The header row stays first.
    if (kind === "row") {
      index = Math.max(1, index);
    }

    if (index === from) {
      return null;
    }

    const origin = this.origin();
    const rect = rects[index];
    const wrapperRect = elements.wrapper.getBoundingClientRect();
    const tableRect = elements.table.getBoundingClientRect();
    const style = this.indicator.style;
    this.indicator.dataset.axis = kind;

    if (kind === "row") {
      const left = Math.max(tableRect.left, wrapperRect.left);
      const right = Math.min(tableRect.right, wrapperRect.right);
      style.left = `${left - origin.x}px`;
      style.width = `${right - left}px`;
      style.top = `${(index > from ? rect.bottom : rect.top) - origin.y}px`;
      style.height = "";
    } else {
      const x = Math.min(Math.max(index > from ? rect.right : rect.left, wrapperRect.left), wrapperRect.right);
      style.left = `${x - origin.x}px`;
      style.top = `${tableRect.top - origin.y}px`;
      style.height = `${tableRect.height}px`;
      style.width = "";
    }

    return index;
  }

  private tableDrop(from: number, point: Point): number | null {
    const { doc } = this.view.state;
    const blocks: DOMRect[] = [];

    doc.forEach((_node, offset) => {
      const dom = this.view.nodeDOM(offset);
      blocks.push(dom instanceof HTMLElement ? dom.getBoundingClientRect() : new DOMRect());
    });

    let index = blocks.findIndex((rect) => rect.height > 0 && point.y < rect.top + rect.height / 2);

    if (index === -1) {
      index = blocks.length;
    }

    if (index === from || index === from + 1) {
      return null;
    }

    const origin = this.origin();
    const surfaceStyle = getComputedStyle(this.view.dom);
    const paddingLeft = Number.parseFloat(surfaceStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(surfaceStyle.paddingRight) || 0;
    const y = index < blocks.length ? blocks[index].top : blocks[blocks.length - 1].bottom;
    const style = this.indicator.style;

    this.indicator.dataset.axis = "row";
    style.left = `${paddingLeft}px`;
    style.width = `${this.view.dom.clientWidth - paddingLeft - paddingRight}px`;
    // Halfway into the gap above the block, where the table will land.
    style.top = `${y - origin.y - 6}px`;
    style.height = "";

    return index;
  }
}

export const TableGrips = Extension.create({
  name: "tableGrips",

  addProseMirrorPlugins() {
    let gripsView: TableGripsView | null = null;

    return [
      new Plugin({
        key: tableGripsKey,
        props: {
          decorations(state) {
            const target = gripsView ? gripTarget(state) : null;

            if (!target || !gripsView) {
              return null;
            }

            const root = gripsView.root;

            return DecorationSet.create(state.doc, [
              Decoration.widget(target.tablePos, () => root, {
                key: GRIPS_CLASS,
                side: -1,
                ignoreSelection: true,
                // The grips handle their own pointer events; ProseMirror must
                // not turn a press on them into a selection change.
                stopEvent: () => true
              })
            ]);
          }
        },
        view(view) {
          gripsView = new TableGripsView(view);

          return {
            update(updatedView) {
              gripsView?.update(updatedView);
            },
            destroy() {
              gripsView?.destroy();
              gripsView = null;
            }
          };
        }
      })
    ];
  }
});
