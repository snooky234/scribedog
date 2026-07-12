import { useState } from "react";
import { createPortal } from "react-dom";

import { Table } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Editor } from "@tiptap/react";

import { Button } from "@/components/ui/button";
import { useDismissablePopover } from "@/lib/useDismissablePopover";

const MAX_ROWS = 8;
const MAX_COLS = 8;

type TableGridPickerProps = {
  editor: Editor;
};

export function TableGridPicker({ editor }: TableGridPickerProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null);

  const isOpen = anchor !== null;

  const close = () => {
    setAnchor(null);
    setHovered(null);
  };

  useDismissablePopover(isOpen, close);

  const insertTable = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    close();
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={t("tableGridPicker.insertTable")}
        aria-expanded={isOpen}
        title={t("tableGridPicker.insertTable")}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={(event) => {
          // Prevents the same click that opens the popover from immediately
          // reaching the window listener in useDismissablePopover and
          // closing it again (self-dismiss).
          event.stopPropagation();

          if (isOpen) {
            close();
            return;
          }

          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ top: rect.bottom + 6, left: rect.left });
        }}
      >
        <Table />
      </Button>

      {anchor
        ? createPortal(
            <div
              className="editor-popover table-grid-picker"
              role="menu"
              aria-label={t("tableGridPicker.chooseSize")}
              style={{ top: anchor.top, left: anchor.left }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="table-grid-picker__grid"
                style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 1fr)` }}
                onMouseLeave={() => setHovered(null)}
              >
                {Array.from({ length: MAX_ROWS * MAX_COLS }, (_, index) => {
                  const row = Math.floor(index / MAX_COLS);
                  const col = index % MAX_COLS;
                  const isActive = hovered !== null && row <= hovered.row && col <= hovered.col;

                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      className={
                        isActive
                          ? "table-grid-picker__cell table-grid-picker__cell--active"
                          : "table-grid-picker__cell"
                      }
                      onMouseEnter={() => setHovered({ row, col })}
                      onClick={() => insertTable(row + 1, col + 1)}
                    />
                  );
                })}
              </div>

              <div className="table-grid-picker__label">
                {hovered ? `${hovered.row + 1} × ${hovered.col + 1}` : t("tableGridPicker.chooseSize")}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
