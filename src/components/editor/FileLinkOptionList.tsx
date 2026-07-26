import { useEffect, useRef } from "react";
import { FileText } from "lucide-react";

import type { VaultFileOption } from "@/lib/editor/fileLinks";

type FileLinkOptionListProps = {
  options: VaultFileOption[];
  activeIndex: number;
  emptyLabel: string;
  /** BEM block of the surrounding widget — dialog and caret popup style alike. */
  block: string;
  listId: string;
  onSelect: (option: VaultFileOption) => void;
  onActiveIndexChange: (index: number) => void;
};

/**
 * The vault-file picker both link entry points share: the toolbar dialog and
 * the "[[" popup at the caret. Keyboard handling stays with the owner (the
 * dialog input resp. the ProseMirror keymap), this component only renders the
 * ranked list and keeps the active row in view.
 */
export function FileLinkOptionList({
  options,
  activeIndex,
  emptyLabel,
  block,
  listId,
  onSelect,
  onActiveIndexChange
}: FileLinkOptionListProps) {
  const activeItemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, options]);

  if (options.length === 0) {
    return <p className={`${block}__no-results`}>{emptyLabel}</p>;
  }

  return (
    <ul className={`${block}__results`} id={listId} role="listbox">
      {options.map((option, index) => {
        const isActive = index === activeIndex;

        return (
          <li
            key={option.filePath}
            ref={isActive ? activeItemRef : undefined}
            id={`${listId}-option-${index}`}
            role="option"
            aria-selected={isActive}
          >
            <button
              type="button"
              className={`${block}__result ${isActive ? `${block}__result--active` : ""}`}
              // The dialog's search input must keep the focus, so the row
              // reacts to mousedown instead of losing it to a click first.
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(option);
              }}
              onMouseEnter={() => onActiveIndexChange(index)}
              title={option.relativePath}
            >
              <FileText aria-hidden="true" />
              <span className={`${block}__result-label`}>{option.label}</span>
              <span className={`${block}__result-path`}>{option.relativePath}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
