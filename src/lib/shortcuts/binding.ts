import type { TFunction } from "i18next";

/**
 * One key combination. `ctrl` covers Ctrl on Windows/Linux and Cmd on macOS —
 * the app never distinguishes the two.
 *
 * Matching uses `code` (the physical key, layout-independent) *or* `key` (what
 * the layout produces). Both are needed: `code` keeps Ctrl+Shift+, working on
 * layouts where Shift turns "," into "<", while `key` keeps Ctrl++ working on
 * layouts where "+" sits on a different physical key than on US.
 */
export type ShortcutBinding = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** KeyboardEvent.code, e.g. "KeyB", "Digit1", "Comma", "ArrowUp". */
  code: string;
  /** KeyboardEvent.key, lowercased. Empty when it carries no useful signal. */
  key: string;
  /** Display text of the base key ("B", "1", "+", "↑") — modifiers are added on render. */
  label: string;
};

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "CapsLock",
  "OSLeft",
  "OSRight"
]);

const SPECIAL_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "Page ↑",
  PageDown: "Page ↓",
  NumpadAdd: "+",
  NumpadSubtract: "-",
  NumpadMultiply: "*",
  NumpadDivide: "/",
  NumpadDecimal: "."
};

/** A label for a physical key, used when a combo is recorded from an event. */
function deriveLabel(code: string, key: string): string {
  const letter = /^Key([A-Z])$/.exec(code);

  if (letter) {
    return letter[1];
  }

  const digit = /^Digit(\d)$/.exec(code);

  if (digit) {
    return digit[1];
  }

  const numpadDigit = /^Numpad(\d)$/.exec(code);

  if (numpadDigit) {
    return `Num ${numpadDigit[1]}`;
  }

  if (/^F\d{1,2}$/.test(code)) {
    return code;
  }

  if (SPECIAL_LABELS[code]) {
    return SPECIAL_LABELS[code];
  }

  // Punctuation and anything else: whatever the layout actually produces is
  // more recognisable than the code name ("#" beats "Backslash").
  if (key.length === 1 && key !== " ") {
    return key.toUpperCase();
  }

  return code;
}

/**
 * Turns a keydown into a binding. Returns null while only modifiers are held —
 * the recorder uses that to keep waiting for the real key.
 */
export function bindingFromEvent(event: KeyboardEvent): ShortcutBinding | null {
  if (MODIFIER_CODES.has(event.code) || event.key === "Dead") {
    return null;
  }

  const key = event.key.length === 1 ? event.key.toLowerCase() : "";

  return {
    ctrl: event.ctrlKey || event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
    code: event.code,
    key,
    label: deriveLabel(event.code, event.key)
  };
}

export function matchesBinding(event: KeyboardEvent, binding: ShortcutBinding | null): boolean {
  if (!binding) {
    return false;
  }

  if (
    binding.ctrl !== (event.ctrlKey || event.metaKey) ||
    binding.alt !== event.altKey ||
    binding.shift !== event.shiftKey
  ) {
    return false;
  }

  if (binding.code && event.code === binding.code) {
    return true;
  }

  return binding.key !== "" && event.key.toLowerCase() === binding.key;
}

/** Two bindings clash when the same keystroke could trigger both. */
export function bindingsConflict(a: ShortcutBinding, b: ShortcutBinding): boolean {
  if (a.ctrl !== b.ctrl || a.alt !== b.alt || a.shift !== b.shift) {
    return false;
  }

  return a.code === b.code || (a.key !== "" && a.key === b.key);
}

export function bindingsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
  return (
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.code === b.code &&
    a.key === b.key
  );
}

/**
 * Shift alone is not enough: Shift+A is how a capital A is typed, so such a
 * binding would swallow ordinary input. Every shortcut needs Ctrl/Cmd or Alt.
 */
export function hasPrimaryModifier(binding: ShortcutBinding): boolean {
  return binding.ctrl || binding.alt;
}

/**
 * Cheap pre-filter for the keydown handlers: a keystroke without Ctrl/Cmd or
 * Alt can never match a binding, so it skips the lookup entirely.
 */
export function couldBeShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

export function formatBinding(t: TFunction, binding: ShortcutBinding): string {
  const parts: string[] = [];

  if (binding.ctrl) {
    parts.push(t("common.keys.ctrl"));
  }

  if (binding.alt) {
    parts.push(t("common.keys.alt"));
  }

  if (binding.shift) {
    parts.push(t("common.keys.shift"));
  }

  parts.push(binding.label);

  return parts.join(" + ");
}

export function isShortcutBinding(value: unknown): value is ShortcutBinding {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ShortcutBinding>;

  return (
    typeof candidate.ctrl === "boolean" &&
    typeof candidate.alt === "boolean" &&
    typeof candidate.shift === "boolean" &&
    typeof candidate.code === "string" &&
    candidate.code.length > 0 &&
    typeof candidate.key === "string" &&
    typeof candidate.label === "string" &&
    candidate.label.length > 0
  );
}
