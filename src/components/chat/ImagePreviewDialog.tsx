import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDismissOnOverlayClick } from "@/hooks/useDismissOnOverlayClick";

type ImagePreviewDialogProps = {
  /** The picture to show, or null when nothing is open. */
  src: string | null;
  /** File name, shown as the caption and used as the accessible label. */
  name: string;
  onClose: () => void;
};

/**
 * Full-size view of an image attached to the chat.
 *
 * The chip's thumbnail is 1.4rem square and cropped, which is enough to tell
 * two attachments apart and no use at all for checking *which* screenshot was
 * attached — the question that comes up the moment more than one is in the
 * composer. So the picture itself opens over the app, with nothing to act on
 * besides closing it again.
 *
 * Follows the app's other dialogs (see DeleteFileDialog) rather than bringing a
 * library: overlay click and Escape close it, and the panel stops the click
 * that would otherwise travel to the overlay.
 */
export function ImagePreviewDialog({ src, name, onClose }: ImagePreviewDialogProps) {
  const dismissProps = useDismissOnOverlayClick(onClose);
  const { t } = useTranslation();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!src) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Stopped as well as prevented: Escape is bound window-wide elsewhere
        // (the chat panel closes on it), and a picture opened from that panel
        // must not close the panel behind it on the way out.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    // Capture phase, so this runs before the window-level shortcut handlers.
    window.addEventListener("keydown", handleKeyDown, true);

    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [src, onClose]);

  // The close button is the only control, so it takes focus — which also moves
  // the focus ring out of the composer behind the overlay.
  useEffect(() => {
    if (src) {
      closeButtonRef.current?.focus();
    }
  }, [src]);

  if (!src) {
    return null;
  }

  return (
    <div className="image-preview" role="presentation" {...dismissProps}>
      <div
        className="image-preview__panel"
        role="dialog"
        aria-modal="true"
        aria-label={name}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="image-preview__bar">
          <span className="image-preview__name" title={name}>
            {name}
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            className="image-preview__close"
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Sized to fit the viewport rather than shown at its natural size: an
            attachment is downscaled to 1568px on its longest edge, which is
            still wider than most windows. */}
        <img className="image-preview__image" src={src} alt={name} />
      </div>
    </div>
  );
}
