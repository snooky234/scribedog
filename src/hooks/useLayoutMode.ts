import { useSyncExternalStore } from "react";

import {
  PHONE_QUERY,
  TABLET_PORTRAIT_QUERY,
  TABLET_QUERY,
  layoutModeForWidth,
  type LayoutMode
} from "@/lib/layoutMode";

// One media query list per query for the whole app; every subscriber sees the
// same answer as the stylesheets, which use the same breakpoints.
const lists = new Map<string, MediaQueryList>();

function queryList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }

  let list = lists.get(query);

  if (!list) {
    list = window.matchMedia(query);
    lists.set(query, list);
  }

  return list;
}

function matches(query: string): boolean {
  return queryList(query)?.matches ?? false;
}

const LAYOUT_QUERIES = [PHONE_QUERY, TABLET_QUERY, TABLET_PORTRAIT_QUERY];

function subscribe(onChange: () => void): () => void {
  const subscribed = LAYOUT_QUERIES.map(queryList).filter(
    (list): list is MediaQueryList => list !== null
  );

  for (const list of subscribed) {
    list.addEventListener("change", onChange);
  }

  return () => {
    for (const list of subscribed) {
      list.removeEventListener("change", onChange);
    }
  };
}

function layoutSnapshot(): LayoutMode {
  if (queryList(PHONE_QUERY) === null) {
    return "desktop";
  }

  if (matches(PHONE_QUERY)) {
    return "phone";
  }

  return matches(TABLET_QUERY) ? "tablet" : "desktop";
}

function sidebarSheetSnapshot(): boolean {
  return matches(PHONE_QUERY) || matches(TABLET_PORTRAIT_QUERY);
}

/**
 * Which of the three layouts the viewport currently gets. Only the places
 * where the React tree differs (a panel rendered as a sheet instead of a grid
 * column, a menu that exists only on narrow screens) read it; everything
 * that is purely visual stays in CSS behind the same breakpoints.
 */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, layoutSnapshot, () =>
    layoutModeForWidth(Number.POSITIVE_INFINITY)
  );
}

/**
 * Whether the file list is a sheet opened from the header instead of a
 * docked column: on the phone, and on a touch tablet held upright.
 */
export function useSidebarAsSheet(): boolean {
  return useSyncExternalStore(subscribe, sidebarSheetSnapshot, () => false);
}
