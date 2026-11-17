// Options of the block gutter (lib/editor/blockGutter.ts), shown in the
// appearance settings below its main switch. App-wide like the switch: they
// are a way of looking at notes, not a property of a vault.

/** When the cursor position shows next to the active block's number. */
export type BlockGutterCursorPosition = "off" | "brief" | "always";

export type BlockGutterOptions = {
  /** Every bar carries its number, not only the active one. */
  numbersOnAll: boolean;
  /** The block the cursor is in gets a tinted background (a code block a frame). */
  highlightActive: boolean;
  cursorPosition: BlockGutterCursorPosition;
};

export const DEFAULT_BLOCK_GUTTER_OPTIONS: BlockGutterOptions = {
  numbersOnAll: false,
  highlightActive: false,
  cursorPosition: "brief"
};

/** How long "brief" keeps the position on screen after the cursor stopped moving. */
export const BLOCK_GUTTER_BRIEF_POSITION_MS = 2000;

const CURSOR_POSITIONS: readonly BlockGutterCursorPosition[] = ["off", "brief", "always"];

/** Reads stored options; anything missing or of the wrong type falls back to its default. */
export function normalizeBlockGutterOptions(value: unknown): BlockGutterOptions {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const flag = (key: "numbersOnAll" | "highlightActive") =>
    typeof source[key] === "boolean" ? (source[key] as boolean) : DEFAULT_BLOCK_GUTTER_OPTIONS[key];

  return {
    numbersOnAll: flag("numbersOnAll"),
    highlightActive: flag("highlightActive"),
    cursorPosition: CURSOR_POSITIONS.includes(source.cursorPosition as BlockGutterCursorPosition)
      ? (source.cursorPosition as BlockGutterCursorPosition)
      : DEFAULT_BLOCK_GUTTER_OPTIONS.cursorPosition
  };
}
