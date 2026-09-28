import { useLayoutEffect, useState, type MouseEventHandler, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useLayoutMode } from "@/hooks/useLayoutMode";

const VIEWPORT_MARGIN_PX = 8;

type ContextMenuSurfaceProps = {
  x: number;
  y: number;
  /** From `useContextMenuState`: a scroll inside this element keeps the menu open. */
  menuRef: RefObject<HTMLDivElement | null>;
  /** Shown as the heading of the phone sheet, where the row is covered. */
  title?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
};

/**
 * Renders a context menu (file-tree rows, the editor selection) into
 * document.body at the click coordinates, then clamps it back inside the
 * viewport after mount. Menu height varies with its entries (single
 * file/folder vs. multi-select), so a fixed size estimate isn't enough â€” a
 * right-click near the bottom or right edge of the window would otherwise
 * open the menu partly or fully off-screen.
 *
 * On a phone the same menu becomes a sheet at the bottom of the screen: a
 * menu at the tap position would have to fold back in at almost every
 * position on a 360 px wide screen, and a sheet is what a touch user expects
 * to come up under a "â€¦" button.
 */
export function ContextMenuSurface({ x, y, menuRef, title, onClick, onMouseDown, children }: ContextMenuSurfaceProps) {
  const [position, setPosition] = useState({ top: y, left: x });
  const isSheet = useLayoutMode() === "phone";

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node || isSheet) {
      return;
    }

    const rect = node.getBoundingClientRect();
    setPosition({
      left: Math.max(VIEWPORT_MARGIN_PX, Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN_PX)),
      top: Math.max(VIEWPORT_MARGIN_PX, Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN_PX))
    });
  }, [x, y, isSheet, menuRef]);

  return createPortal(
    <>
      {/* The tree's own window listener closes the menu on the tap; this only
          dims what is behind the sheet. */}
      {isSheet ? <div className="file-tree-context-menu__backdrop" aria-hidden="true" /> : null}
      <div
        ref={menuRef}
        className={isSheet ? "file-tree-context-menu file-tree-context-menu--sheet" : "file-tree-context-menu"}
        role="menu"
        aria-label={title}
        style={isSheet ? undefined : { top: position.top, left: position.left }}
        onClick={onClick}
        onMouseDown={onMouseDown}
      >
        {isSheet && title ? <p className="file-tree-context-menu__title">{title}</p> : null}
        {children}
      </div>
    </>,
    document.body
  );
}
