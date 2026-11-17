import type { RefObject } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Check, PencilLine } from "lucide-react";

import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import { IMAGE_SCALE_CHOICES, canApplyImageScale, type ImageScaleChoice } from "@/lib/editor/imageScale";

export type ImageContextMenuState = {
  x: number;
  y: number;
  /** The page width the percentages refer to, measured when the menu opened. */
  pageWidth: number | null;
  /** The choice the image's current width corresponds to, if any. */
  active: ImageScaleChoice | null;
  /** The drawing entry: edit a drawing, draw on a raster image, or none. */
  drawing: "edit" | "drawOn" | null;
};

type ImageContextMenuProps = ImageContextMenuState & {
  menuRef: RefObject<HTMLDivElement | null>;
  onSelect: (choice: ImageScaleChoice) => void;
  onDrawing: () => void;
  onClose: () => void;
};

/** "50 % of page width" / "Original size", shared with the touch bar's tooltips. */
export function imageScaleLabel(t: TFunction, choice: ImageScaleChoice): string {
  return choice === "original" ? t("imageView.scaleOriginal") : t("imageView.scalePageWidth", { percent: choice });
}

/**
 * The right-click menu on an image: its preset sizes, and below them the
 * drawing entry where the image offers one. The buttons swallow
 * mousedown so the editor keeps its focus and the image stays selected.
 */
export function ImageContextMenu({
  x,
  y,
  pageWidth,
  active,
  drawing,
  menuRef,
  onSelect,
  onDrawing,
  onClose
}: ImageContextMenuProps) {
  const { t } = useTranslation();

  return (
    <ContextMenuSurface
      x={x}
      y={y}
      menuRef={menuRef}
      title={t("imageView.scaleGroup")}
      onMouseDown={(event) => event.preventDefault()}
    >
      {IMAGE_SCALE_CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          role="menuitemradio"
          aria-checked={active === choice}
          className="file-tree-context-menu__item"
          disabled={!canApplyImageScale(choice, pageWidth)}
          onClick={() => {
            onClose();
            onSelect(choice);
          }}
        >
          <span className="file-tree-context-menu__label">{imageScaleLabel(t, choice)}</span>
          <span className="file-tree-context-menu__keys" aria-hidden="true">
            {active === choice ? <Check size={14} /> : null}
          </span>
        </button>
      ))}
      {drawing ? (
        <>
          <div className="editor-toolbar__menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => {
              onClose();
              onDrawing();
            }}
          >
            <span className="file-tree-context-menu__label">
              {t(drawing === "edit" ? "imageView.editDrawing" : "imageView.drawOnImage")}
            </span>
            <span className="file-tree-context-menu__keys" aria-hidden="true">
              <PencilLine size={14} />
            </span>
          </button>
        </>
      ) : null}
    </ContextMenuSurface>
  );
}
