import { useLayoutEffect, useRef, useState, type MouseEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN_PX = 8;

type ContextMenuSurfaceProps = {
  x: number;
  y: number;
  onClick?: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
};

/**
 * Renders the file-tree row context menu into document.body at the click
 * coordinates, then clamps it back inside the viewport after mount. Menu
 * height varies with `contextMenu.kind` (single file/folder vs. multi-select),
 * so a fixed size estimate isn't enough — a right-click near the bottom or
 * right edge of the window would otherwise open the menu partly or fully
 * off-screen.
 */
export function ContextMenuSurface({ x, y, onClick, children }: ContextMenuSurfaceProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) {
      return;
    }

    const rect = node.getBoundingClientRect();
    setPosition({
      left: Math.max(VIEWPORT_MARGIN_PX, Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN_PX)),
      top: Math.max(VIEWPORT_MARGIN_PX, Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN_PX))
    });
  }, [x, y]);

  return createPortal(
    <div
      ref={menuRef}
      className="file-tree-context-menu"
      role="menu"
      style={{ top: position.top, left: position.left }}
      onClick={onClick}
    >
      {children}
    </div>,
    document.body
  );
}
