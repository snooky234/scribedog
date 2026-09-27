import { useTranslation } from "react-i18next";

import { formatBinding } from "@/lib/shortcuts/binding";
import type { ShortcutActionId } from "@/lib/shortcuts/definitions";
import { resolveBinding } from "@/lib/shortcuts/resolve";
import { useShortcutsStore } from "@/store/useShortcutsStore";

/**
 * The key combination an action is on right now ("Ctrl+P"), following the
 * user's own bindings; null for an action without one.
 */
export function useShortcutLabel(id: ShortcutActionId): string | null {
  const { t } = useTranslation();
  const binding = useShortcutsStore((state) => resolveBinding(state.overrides, id));

  return binding ? formatBinding(t, binding) : null;
}
