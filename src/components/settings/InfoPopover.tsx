import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useDismissablePopover } from "@/lib/useDismissablePopover";

type InfoPopoverProps = {
  /** The long explanation: background, side effects, where a value is stored. */
  text: string;
  /** Where the full story is, when the popover can only hold the short one. */
  link?: { href: string; label: string };
};

type Anchor = { top: number; bottom: number; left: number; right: number };

/** How long the mouse may be between the icon and the popover before it closes. */
const HOVER_CLOSE_DELAY_MS = 120;
const GAP_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

/**
 * The "(i)" behind a setting's label: hovering shows the long text, a click
 * (or Enter/Space) pins it until Escape or a click elsewhere. Not a `title`
 * tooltip on purpose — that one cannot be reached on touch, cannot be styled
 * and disappears before a paragraph is read.
 *
 * The text is also in the DOM while the popover is closed, hidden, and
 * referenced through aria-describedby, so a screen reader gets it from the
 * button itself without having to open anything.
 */
export function InfoPopover({ text, link }: InfoPopoverProps) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const isOpen = anchor !== null;

  const cancelScheduledClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const close = useCallback(() => {
    cancelScheduledClose();
    setAnchor(null);
    setPinned(false);
    setPosition(null);
  }, []);

  const openAt = (button: HTMLButtonElement) => {
    cancelScheduledClose();
    const rect = button.getBoundingClientRect();
    setAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
  };

  // Hover-open only: a pinned popover survives the mouse leaving.
  const scheduleHoverClose = () => {
    if (pinned) {
      return;
    }

    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      close();
    }, HOVER_CLOSE_DELAY_MS);
  };

  useEffect(() => cancelScheduledClose, []);

  useDismissablePopover(isOpen, close, popoverRef);

  // The settings dialog closes on Escape through its own window listener.
  // While the popover is up, Escape belongs to the popover — caught in the
  // capture phase so the dialog's bubble-phase listener never sees it.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        buttonRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, close]);

  // Below the icon, left-aligned; flipped above or right-aligned only when
  // the viewport edge is in the way. Measured after mount because the width
  // depends on the text.
  useLayoutEffect(() => {
    const element = popoverRef.current;

    if (!anchor || !element) {
      return;
    }

    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      const maxLeft = window.innerWidth - VIEWPORT_MARGIN_PX - width;
      const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(anchor.left, maxLeft));
      const below = anchor.bottom + GAP_PX;
      const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN_PX;
      const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN_PX, anchor.top - GAP_PX - height);

      setPosition({ top, left });
    };

    place();

    const observer = new ResizeObserver(place);
    observer.observe(element);

    return () => observer.disconnect();
  }, [anchor]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="info-popover__trigger"
        aria-label={t("settingsDialog.moreInfo")}
        aria-describedby={descriptionId}
        aria-expanded={isOpen}
        onMouseEnter={(event) => {
          if (!isOpen) {
            openAt(event.currentTarget);
          } else {
            cancelScheduledClose();
          }
        }}
        onMouseLeave={scheduleHoverClose}
        onFocus={(event) => {
          if (!isOpen) {
            openAt(event.currentTarget);
          }
        }}
        onBlur={(event) => {
          // Tabbing onto the link inside the popover is not leaving it.
          if (popoverRef.current?.contains(event.relatedTarget)) {
            return;
          }

          close();
        }}
        onClick={(event) => {
          // The same click must not reach useDismissablePopover's window
          // listener, which would close what was just opened.
          event.stopPropagation();

          if (pinned) {
            close();
            return;
          }

          openAt(event.currentTarget);
          setPinned(true);
        }}
      >
        <Info aria-hidden="true" />
      </button>

      <span id={descriptionId} hidden>
        {text}
      </span>

      {anchor
        ? createPortal(
            <div
              ref={popoverRef}
              className="info-popover"
              role="tooltip"
              style={
                position
                  ? { top: position.top, left: position.left }
                  : { top: anchor.bottom + GAP_PX, left: anchor.left, visibility: "hidden" }
              }
              onMouseEnter={cancelScheduledClose}
              onMouseLeave={scheduleHoverClose}
              // A click inside must neither move focus off the trigger (its
              // blur closes the popover) nor count as a click outside.
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => event.stopPropagation()}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  close();
                }
              }}
            >
              {text}
              {link ? (
                <a
                  className="info-popover__link"
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  // The trigger's mousedown guard keeps focus off the link,
                  // so the link needs its own for the keyboard path.
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  {link.label}
                </a>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
