import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { FileLinkOptionList } from "@/components/editor/FileLinkOptionList";
import {
  buildFileLinkHref,
  filterVaultFileOptions,
  type VaultFileOption
} from "@/lib/editor/fileLinks";

export type LinkDialogResult = {
  href: string;
  /** Text to insert with the link — only used when nothing is selected. */
  text: string;
};

type LinkDialogProps = {
  open: boolean;
  /** Href of the link the caret currently sits in, "" for a new link. */
  initialHref: string;
  /** Selected passage that becomes the link text, "" when inserting at the caret. */
  selectedText: string;
  isLinkActive: boolean;
  fileOptions: VaultFileOption[];
  currentFilePath: string | null;
  onSubmit: (result: LinkDialogResult) => void;
  onRemove: () => void;
  onCancel: () => void;
};

const MAX_VISIBLE_FILE_OPTIONS = 8;

/**
 * Insert-link dialog: either a typed URL or one of the vault's own notes,
 * picked from the filtered file list. A picked note fills the URL field with
 * the path relative to the file being edited, so both ways end up as the same
 * kind of Markdown link.
 */
export function LinkDialog({
  open,
  initialHref,
  selectedText,
  isLinkActive,
  fileOptions,
  currentFilePath,
  onSubmit,
  onRemove,
  onCancel
}: LinkDialogProps) {
  const { t } = useTranslation();
  const [href, setHref] = useState(initialHref);
  const [text, setText] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const hrefInputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = useMemo(
    () => filterVaultFileOptions(fileOptions, fileQuery, MAX_VISIBLE_FILE_OPTIONS),
    [fileOptions, fileQuery]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setHref(initialHref);
    setText("");
    setFileQuery("");
    setActiveIndex(0);
  }, [open, initialHref]);

  useEffect(() => {
    if (open) {
      hrefInputRef.current?.focus();
      hrefInputRef.current?.select();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  const trimmedHref = href.trim();
  const canSubmit = trimmedHref.length > 0;
  // A selection — or an existing link the caret sits in — already provides the
  // link text; only a link inserted at the caret needs one of its own.
  const showTextField = !selectedText && !isLinkActive;

  const submit = () => {
    if (!canSubmit) {
      return;
    }

    onSubmit({ href: trimmedHref, text: text.trim() });
  };

  const chooseFile = (option: VaultFileOption) => {
    // Without an open file there is nothing to make the path relative to, so
    // the vault list is not offered in that case (see fileOptions in Editor).
    setHref(currentFilePath ? buildFileLinkHref(currentFilePath, option.filePath) : option.filePath);

    if (!selectedText && !text.trim()) {
      setText(option.label);
    }
  };

  const handleFileQueryKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (filteredOptions.length === 0) {
        return;
      }

      const offset = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (current) =>
          (current + offset + filteredOptions.length) % filteredOptions.length
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      const option = filteredOptions[activeIndex];

      if (option) {
        chooseFile(option);
      } else {
        submit();
      }
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="unsaved-dialog" role="presentation" onClick={onCancel}>
      <div
        className="unsaved-dialog__panel link-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">{t("linkDialog.eyebrow")}</p>
        <h3 id="link-dialog-title">{t(isLinkActive ? "linkDialog.titleEdit" : "linkDialog.title")}</h3>
        <p className="unsaved-dialog__description">
          {selectedText
            ? t("linkDialog.descriptionSelection", { text: selectedText })
            : isLinkActive
              ? t("linkDialog.descriptionEdit")
              : t("linkDialog.description")}
        </p>

        <div className="link-dialog__form">
          <label className="link-dialog__field">
            <span>{t("linkDialog.urlLabel")}</span>
            <input
              ref={hrefInputRef}
              type="text"
              value={href}
              spellCheck={false}
              placeholder={t("linkDialog.urlPlaceholder")}
              onChange={(event) => setHref(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </label>

          {showTextField ? (
            <label className="link-dialog__field">
              <span>{t("linkDialog.textLabel")}</span>
              <input
                type="text"
                value={text}
                placeholder={t("linkDialog.textPlaceholder")}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            </label>
          ) : null}

          {fileOptions.length > 0 ? (
            <div className="link-dialog__field">
              <span>{t("linkDialog.fileLabel")}</span>
              <input
                type="text"
                value={fileQuery}
                spellCheck={false}
                role="combobox"
                aria-expanded="true"
                aria-controls="link-dialog-files"
                aria-activedescendant={
                  filteredOptions.length > 0 ? `link-dialog-files-option-${activeIndex}` : undefined
                }
                placeholder={t("linkDialog.filePlaceholder")}
                onChange={(event) => {
                  setFileQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleFileQueryKeyDown}
              />
              <FileLinkOptionList
                options={filteredOptions}
                activeIndex={activeIndex}
                emptyLabel={t("linkDialog.noFileMatches")}
                block="link-dialog"
                listId="link-dialog-files"
                onSelect={chooseFile}
                onActiveIndexChange={setActiveIndex}
              />
            </div>
          ) : null}
        </div>

        <div className="unsaved-dialog__actions">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          {isLinkActive ? (
            <Button type="button" variant="outline" onClick={onRemove}>
              {t("linkDialog.remove")}
            </Button>
          ) : null}
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {t("linkDialog.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
