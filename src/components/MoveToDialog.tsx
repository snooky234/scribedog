import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, FolderOpen, Home } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useDismissOnOverlayClick } from "@/hooks/useDismissOnOverlayClick";
import { listMoveTargets, type MoveSource } from "@/lib/moveTargets";
import { cn } from "@/lib/utils";

/** Beyond this many folders the list gets a filter field. */
const FILTER_THRESHOLD = 10;

export type MoveRequest = {
  sources: MoveSource[];
  /** Display name of the single entry, or null for a multi-selection. */
  label: string | null;
};

type MoveToDialogProps = {
  request: MoveRequest | null;
  fileRelativePaths: string[];
  emptyFolderRelativePaths: string[];
  isMoving: boolean;
  onConfirm: (targetRelativePath: string) => void;
  onCancel: () => void;
};

/**
 * Folder picker behind "Move to…" in the tree's context menu. Drag and drop
 * needs a mouse; this is the way a note or folder changes place on a touch
 * screen, and a keyboard-only path on the desktop.
 */
export function MoveToDialog({
  request,
  fileRelativePaths,
  emptyFolderRelativePaths,
  isMoving,
  onConfirm,
  onCancel
}: MoveToDialogProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const targets = useMemo(
    () =>
      request ? listMoveTargets(fileRelativePaths, emptyFolderRelativePaths, request.sources) : [],
    [request, fileRelativePaths, emptyFolderRelativePaths]
  );

  const showFilter = targets.length > FILTER_THRESHOLD;
  const query = filter.trim().toLowerCase();
  const visibleTargets = query
    ? targets.filter((target) => target.relativePath.toLowerCase().includes(query))
    : targets;

  useEffect(() => {
    if (request) {
      setFilter("");
      setSelected(null);
    }
  }, [request]);

  useEffect(() => {
    if (!request) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isMoving) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [request, isMoving, onCancel]);

  useEffect(() => {
    if (request) {
      listRef.current?.focus();
    }
  }, [request]);

  const dismissProps = useDismissOnOverlayClick(isMoving ? null : onCancel);

  if (!request) {
    return null;
  }

  const selectedTarget = targets.find((target) => target.relativePath === selected);
  const canConfirm = selectedTarget !== undefined && !selectedTarget.disabled && !isMoving;

  const confirm = () => {
    if (canConfirm && selected !== null) {
      onConfirm(selected);
    }
  };

  return (
    <div
      className="unsaved-dialog"
      role="presentation"
      {...dismissProps}
    >
      <div
        className="unsaved-dialog__panel move-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">{t("moveDialog.eyebrow")}</p>
        <h3 id="move-dialog-title">
          {request.label
            ? t("moveDialog.title", { name: request.label })
            : t("moveDialog.titleMultiple", { count: request.sources.length })}
        </h3>

        {showFilter ? (
          <input
            type="search"
            className="move-dialog__filter"
            value={filter}
            placeholder={t("moveDialog.filterPlaceholder")}
            aria-label={t("moveDialog.filterPlaceholder")}
            onChange={(event) => setFilter(event.target.value)}
          />
        ) : null}

        <div
          ref={listRef}
          className="move-dialog__list"
          role="listbox"
          aria-label={t("moveDialog.listLabel")}
          tabIndex={0}
          onKeyDown={(event) => {
            const enabled = visibleTargets.filter((target) => !target.disabled);

            if (enabled.length === 0) {
              return;
            }

            const index = enabled.findIndex((target) => target.relativePath === selected);

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected(enabled[Math.min(index + 1, enabled.length - 1)].relativePath);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected(enabled[Math.max(index - 1, 0)].relativePath);
            } else if (event.key === "Enter") {
              event.preventDefault();
              confirm();
            }
          }}
        >
          {visibleTargets.length === 0 ? (
            <p className="move-dialog__empty">{t("moveDialog.noMatch")}</p>
          ) : (
            visibleTargets.map((target) => {
              const isSelected = target.relativePath === selected;

              return (
                <button
                  key={target.relativePath}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={target.disabled}
                  className={cn("move-dialog__item", isSelected && "move-dialog__item--selected")}
                  style={{ paddingLeft: `${0.6 + target.depth * 1.1}rem` }}
                  title={target.relativePath || t("moveDialog.root")}
                  onClick={() => setSelected(target.relativePath)}
                  onDoubleClick={() => {
                    if (!target.disabled) {
                      onConfirm(target.relativePath);
                    }
                  }}
                >
                  {target.relativePath === "" ? (
                    <Home aria-hidden="true" />
                  ) : isSelected ? (
                    <FolderOpen aria-hidden="true" />
                  ) : (
                    <Folder aria-hidden="true" />
                  )}
                  <span className="move-dialog__item-name">
                    {target.relativePath === "" ? t("moveDialog.root") : target.name}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="unsaved-dialog__actions">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isMoving}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={confirm} disabled={!canConfirm} data-testid="move-confirm">
            {isMoving ? t("moveDialog.moving") : t("moveDialog.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
