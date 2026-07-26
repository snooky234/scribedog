import { bindingsConflict, bindingsEqual, matchesBinding, type ShortcutBinding } from "@/lib/shortcuts/binding";
import {
  SHORTCUT_DEFINITIONS,
  SHORTCUT_DEFINITIONS_BY_ID,
  type ShortcutActionId,
  type ShortcutScope
} from "@/lib/shortcuts/definitions";
import type { ShortcutOverrides } from "@/lib/shortcuts/storage";

export function resolveBinding(overrides: ShortcutOverrides, id: ShortcutActionId): ShortcutBinding {
  const override = overrides[id];

  if (override) {
    return override;
  }

  const definition = SHORTCUT_DEFINITIONS_BY_ID.get(id);

  if (!definition) {
    throw new Error(`Unknown shortcut action: ${id}`);
  }

  return definition.defaultBinding;
}

export function isCustomBinding(overrides: ShortcutOverrides, id: ShortcutActionId): boolean {
  const override = overrides[id];
  const definition = SHORTCUT_DEFINITIONS_BY_ID.get(id);

  return Boolean(override && definition && !bindingsEqual(override, definition.defaultBinding));
}

function matchesAction(
  overrides: ShortcutOverrides,
  event: KeyboardEvent,
  id: ShortcutActionId
): boolean {
  const definition = SHORTCUT_DEFINITIONS_BY_ID.get(id);

  if (!definition) {
    return false;
  }

  const override = overrides[id];

  if (override) {
    return matchesBinding(event, override);
  }

  return (
    matchesBinding(event, definition.defaultBinding) ||
    (definition.defaultAlternates ?? []).some((alternate) => matchesBinding(event, alternate))
  );
}

/** The action a keystroke triggers in the given scope, or null. */
export function matchShortcut(
  overrides: ShortcutOverrides,
  event: KeyboardEvent,
  scope: ShortcutScope
): ShortcutActionId | null {
  for (const definition of SHORTCUT_DEFINITIONS) {
    if (definition.scope === scope && matchesAction(overrides, event, definition.id)) {
      return definition.id;
    }
  }

  return null;
}

/**
 * True when a keystroke is a *former* default of some action in this scope —
 * the user moved that action elsewhere. Such a combo has to be swallowed
 * rather than ignored, otherwise TipTap's own keymap (Ctrl+B, Ctrl+I, …) or
 * the webview (Ctrl+P, Ctrl+F) would quietly take it over again.
 *
 * Only call this after `matchShortcut` came back empty.
 */
export function isRetiredDefault(
  overrides: ShortcutOverrides,
  event: KeyboardEvent,
  scope: ShortcutScope
): boolean {
  return SHORTCUT_DEFINITIONS.some((definition) => {
    if (definition.scope !== scope || !overrides[definition.id]) {
      return false;
    }

    return (
      matchesBinding(event, definition.defaultBinding) ||
      (definition.defaultAlternates ?? []).some((alternate) => matchesBinding(event, alternate))
    );
  });
}

/**
 * The action that already owns `binding`, ignoring `id` itself. Scope is
 * deliberately not considered: a global shortcut fires while the editor has
 * focus too, so an overlap there would be a real clash.
 */
export function findConflict(
  overrides: ShortcutOverrides,
  id: ShortcutActionId,
  binding: ShortcutBinding
): ShortcutActionId | null {
  for (const definition of SHORTCUT_DEFINITIONS) {
    if (definition.id === id) {
      continue;
    }

    if (bindingsConflict(resolveBinding(overrides, definition.id), binding)) {
      return definition.id;
    }
  }

  return null;
}
