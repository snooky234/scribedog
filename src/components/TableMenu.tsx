import { useState } from "react";
import { createPortal } from "react-dom";

import {
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
import { useDismissablePopover } from "@/lib/useDismissablePopover";

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
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const isOpen = anchor !== null;
  const close = () => setAnchor(null);

  useDismissablePopover(isOpen, close);

  const isInHeaderRow = editor.isActive("tableHeader");

  const run = (command: () => void) => {
    command();
    close();
  };

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

          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ top: rect.bottom + 6, left: rect.left });
        }}
      >
        <TableProperties />
      </Button>

      {anchor
        ? createPortal(
            <div
              className="editor-popover table-menu"
              role="menu"
              aria-label={t("tableMenu.options")}
              style={{ top: anchor.top, left: anchor.left }}
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
