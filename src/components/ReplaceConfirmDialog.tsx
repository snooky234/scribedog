import { useEffect, useState } from "react";
import { Replace } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

export type ReplaceMatchItem = {
  id: string;
  before: string;
  text: string;
  after: string;
};

export type ReplaceFileGroup = {
  filePath: string;
  fileLabel: string;
  items: ReplaceMatchItem[];
};

type ReplaceConfirmDialogProps = {
  open: boolean;
  groups: ReplaceFileGroup[];
  replacement: string;
  onConfirm: (selectedIds: Set<string>) => void;
  onCancel: () => void;
};

export function ReplaceConfirmDialog({
  open,
  groups,
  replacement,
  onConfirm,
  onCancel
}: ReplaceConfirmDialogProps) {
  const { t } = useTranslation();
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());

  // Every match starts selected each time the dialog opens for a new
  // replace action.
  useEffect(() => {
    if (open) {
      setDeselectedIds(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  const totalCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const selectedCount = totalCount - deselectedIds.size;

  const toggleItem = (id: string, checked: boolean) => {
    setDeselectedIds((current) => {
      const next = new Set(current);

      if (checked) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const toggleGroup = (group: ReplaceFileGroup, checked: boolean) => {
    setDeselectedIds((current) => {
      const next = new Set(current);

      for (const item of group.items) {
        if (checked) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
      }

      return next;
    });
  };

  const confirmSelection = () => {
    const selectedIds = new Set<string>();

    for (const group of groups) {
      for (const item of group.items) {
        if (!deselectedIds.has(item.id)) {
          selectedIds.add(item.id);
        }
      }
    }

    onConfirm(selectedIds);
  };

  return (
    <div className="ai-dialog" role="presentation" onClick={onCancel}>
      <div
        className="ai-dialog__panel ai-dialog__panel--check"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="ai-dialog__eyebrow">{t("findReplace.confirmEyebrow")}</p>
        <h3 id="replace-confirm-title" className="ai-dialog__title">
          <Replace className="ai-dialog__title-icon" aria-hidden="true" />
          {t("findReplace.confirmTitle")}
        </h3>
        <p className="ai-dialog__description">{t("findReplace.confirmDescription")}</p>

        <div className="replace-confirm__groups">
          {groups.map((group) => {
            const groupSelectedCount = group.items.filter((item) => !deselectedIds.has(item.id)).length;

            return (
              <section className="replace-confirm__group" key={group.filePath}>
                <label className="replace-confirm__group-header">
                  <input
                    type="checkbox"
                    checked={groupSelectedCount === group.items.length}
                    ref={(input) => {
                      if (input) {
                        input.indeterminate =
                          groupSelectedCount > 0 && groupSelectedCount < group.items.length;
                      }
                    }}
                    onChange={(event) => toggleGroup(group, event.target.checked)}
                  />
                  <span className="replace-confirm__group-label">{group.fileLabel}</span>
                  <span className="replace-confirm__group-count">
                    {t("findReplace.confirmGroupCount", {
                      selected: groupSelectedCount,
                      total: group.items.length
                    })}
                  </span>
                </label>
                <ul className="replace-confirm__list">
                  {group.items.map((item) => (
                    <li className="replace-confirm__item" key={item.id}>
                      <label className="replace-confirm__item-label">
                        <input
                          type="checkbox"
                          checked={!deselectedIds.has(item.id)}
                          onChange={(event) => toggleItem(item.id, event.target.checked)}
                        />
                        <span className="replace-confirm__snippet">
                          <span className="replace-confirm__context">{item.before}</span>
                          <del className="replace-confirm__old">{item.text}</del>
                          <ins className="replace-confirm__new">{replacement}</ins>
                          <span className="replace-confirm__context">{item.after}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="ai-dialog__actions">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={selectedCount === 0} onClick={confirmSelection}>
            <Replace aria-hidden="true" />
            {t("findReplace.confirmAction", { count: selectedCount })}
          </Button>
        </div>
      </div>
    </div>
  );
}
