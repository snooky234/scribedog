import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns3,
  PanelBottomClose,
  PanelTopClose,
  Rows3,
  TableProperties,
  Trash2
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Editor } from "@tiptap/react";

import { Button } from "@/components/ui/button";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { tableLineStep, type TableAxis } from "@/lib/editor/tableMove";
import { useDismissablePopover } from "@/lib/useDismissablePopover";
import {
  anchorForTrigger,
  popoverStyle,
  usePopoverOverflowAlign,
  type PopoverAnchor
} from "@/lib/usePopoverOverflowAlign";

type TableMenuProps = {
  editor: Editor;
};

type MenuItemProps = {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

function MenuItem({ icon, label, disabled, danger, onSelect }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={
        danger
          ? "editor-popover__item editor-popover__item--danger"
          : "editor-popover__item"
      }
      onClick={onSelect}
    >
      {icon}
      {label}
    </button>
  );
}

// Row operations are locked while the cursor is in the header row:
// prosemirror-tables copies the cell type of adjacent rows when inserting or
// deleting rows, which from the header row can easily produce a second
// header row or a table with no header row at all. Since GFM tables (and
// thus tiptap-markdown) require exactly one header row in first position,
// that would silently fall the markdown export back to raw HTML — unreadable
// again on the next load with HTML parsing disabled.
export function TableMenu({ editor }: TableMenuProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const [align, setAlign] = useState<"left" | "right">("left");
  const [valign, setValign] = useState<"below" | "above">("below");
  const popoverRef = useRef<HTMLDivElement>(null);
  const isSheet = useLayoutMode() === "phone";

  const isOpen = anchor !== null;
  const close = () => setAnchor(null);

  useDismissablePopover(isOpen, close);
  usePopoverOverflowAlign(anchor, popoverRef, setAlign, setValign);

  const isInHeaderRow = editor.isActive("tableHeader");

  const run = (command: () => void) => {
    command();
    close();
  };

  // The same step as Alt+Shift+Arrow (tableMove.ts): the header row stays
  // first, and a table with merged cells is not reordered.
  const moveStep = (axis: TableAxis, delta: -1 | 1) => tableLineStep(editor.state, axis, delta).tr;
  const runMove = (axis: TableAxis, delta: -1 | 1) =>
    run(() => {
      const tr = moveStep(axis, delta);

      if (tr) {
        editor.view.dispatch(tr);
      }

      editor.commands.focus();
    });

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={t("tableMenu.options")}
        aria-expanded={isOpen}
        title={t("tableMenu.options")}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={(event) => {
          // Prevents the same click that opens the menu from immediately
          // reaching the window listener in useDismissablePopover and
          // closing it again (self-dismiss).
          event.stopPropagation();

          if (isOpen) {
            close();
            return;
          }

          setAlign("left");
          setValign("below");
          setAnchor(anchorForTrigger(event.currentTarget.getBoundingClientRect()));
        }}
      >
        <TableProperties />
      </Button>

      {anchor
        ? createPortal(
            <div
              ref={popoverRef}
              className={isSheet ? "editor-popover editor-popover--sheet table-menu" : "editor-popover table-menu"}
              role="menu"
              aria-label={t("tableMenu.options")}
              style={isSheet ? undefined : popoverStyle(anchor, align, valign)}
              onClick={(event) => event.stopPropagation()}
            >
              <MenuItem
                icon={<Columns3 aria-hidden="true" />}
                label={t("tableMenu.addColumnBefore")}
                onSelect={() => run(() => editor.chain().focus().addColumnBefore().run())}
              />
              <MenuItem
                icon={<Columns3 aria-hidden="true" />}
                label={t("tableMenu.addColumnAfter")}
                onSelect={() => run(() => editor.chain().focus().addColumnAfter().run())}
              />
              <MenuItem
                icon={<ArrowLeft aria-hidden="true" />}
                label={t("tableMenu.moveColumnLeft")}
                disabled={!moveStep("column", -1)}
                onSelect={() => runMove("column", -1)}
              />
              <MenuItem
                icon={<ArrowRight aria-hidden="true" />}
                label={t("tableMenu.moveColumnRight")}
                disabled={!moveStep("column", 1)}
                onSelect={() => runMove("column", 1)}
              />
              <MenuItem
                icon={<Trash2 aria-hidden="true" />}
                label={t("tableMenu.deleteColumn")}
                danger
                disabled={!editor.can().deleteColumn()}
                onSelect={() => run(() => editor.chain().focus().deleteColumn().run())}
              />

              <div className="editor-popover__separator" role="separator" />

              <MenuItem
                icon={<PanelTopClose aria-hidden="true" />}
                label={t("tableMenu.addRowBefore")}
                disabled={isInHeaderRow}
                onSelect={() => run(() => editor.chain().focus().addRowBefore().run())}
              />
              <MenuItem
                icon={<PanelBottomClose aria-hidden="true" />}
                label={t("tableMenu.addRowAfter")}
                disabled={isInHeaderRow}
                onSelect={() => run(() => editor.chain().focus().addRowAfter().run())}
              />
              <MenuItem
                icon={<ArrowUp aria-hidden="true" />}
                label={t("tableMenu.moveRowUp")}
                disabled={!moveStep("row", -1)}
                onSelect={() => runMove("row", -1)}
              />
              <MenuItem
                icon={<ArrowDown aria-hidden="true" />}
                label={t("tableMenu.moveRowDown")}
                disabled={!moveStep("row", 1)}
                onSelect={() => runMove("row", 1)}
              />
              <MenuItem
                icon={<Rows3 aria-hidden="true" />}
                label={t("tableMenu.deleteRow")}
                danger
                disabled={isInHeaderRow || !editor.can().deleteRow()}
                onSelect={() => run(() => editor.chain().focus().deleteRow().run())}
              />

              <div className="editor-popover__separator" role="separator" />

              <MenuItem
                icon={<Trash2 aria-hidden="true" />}
                label={t("tableMenu.deleteTable")}
                danger
                onSelect={() => run(() => editor.chain().focus().deleteTable().run())}
              />
            </div>,
            document.body
          )
        : null}
    </>
  );
}
