import { useCallback, useRef, useState } from "react";

import { useDismissablePopover } from "@/lib/useDismissablePopover";

/**
 * State for a right-click menu rendered through `ContextMenuSurface`, plus
 * everything that closes it again: any click, another right-click, scrolling
 * outside the menu and Escape. `T` carries whatever the menu needs beyond its
 * coordinates; `menuRef` goes on the menu element, so scrolling the menu
 * itself (the phone sheet has a height limit) does not close it.
 */
export function useContextMenuState<T>() {
  const [contextMenu, setContextMenu] = useState<T | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useDismissablePopover(contextMenu !== null, closeContextMenu, menuRef);

  return { contextMenu, setContextMenu, menuRef };
}
