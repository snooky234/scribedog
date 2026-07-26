import { useCallback, useRef, useState, type MutableRefObject } from "react";

import type { Editor as TipTapEditor } from "@tiptap/react";

import { filterVaultFileOptions, type VaultFileOption } from "@/lib/editor/fileLinks";

/**
 * Wiki-style link entry: typing "[[" opens a picker for the vault's notes at
 * the caret, and choosing one replaces the typed "[[query" with a normal
 * Markdown link. Only the *input* is wiki-style — nothing writes "[[…]]" into
 * the document, so linked notes stay plain Markdown (see lib/editor/fileLinks).
 */

// Everything typed after "[[" up to the caret, as long as it stays on one line
// and contains no further brackets — a typed "]]" ends the suggestion.
const TRIGGER_PATTERN = /\[\[([^[\]\n]*)$/;
const MAX_QUERY_LENGTH = 80;
const MAX_VISIBLE_OPTIONS = 8;

export type FileLinkSuggestionState = {
  /** Document range of the typed trigger, replaced by the chosen link. */
  from: number;
  to: number;
  query: string;
  options: VaultFileOption[];
  activeIndex: number;
  /** Viewport coordinates of the trigger, for placing the popup. */
  coords: { left: number; top: number; bottom: number };
};

type UseFileLinkSuggestionOptions = {
  editorRef: MutableRefObject<TipTapEditor | null>;
  fileOptions: VaultFileOption[];
  onSelect: (option: VaultFileOption, range: { from: number; to: number }) => void;
};

export function useFileLinkSuggestion({
  editorRef,
  fileOptions,
  onSelect
}: UseFileLinkSuggestionOptions) {
  const [suggestion, setSuggestion] = useState<FileLinkSuggestionState | null>(null);
  // The ProseMirror keymap runs outside React's render cycle and has to see the
  // current suggestion synchronously, so state and ref are always set together.
  const suggestionRef = useRef<FileLinkSuggestionState | null>(null);
  const fileOptionsRef = useRef(fileOptions);
  fileOptionsRef.current = fileOptions;

  const update = useCallback((next: FileLinkSuggestionState | null) => {
    suggestionRef.current = next;
    setSuggestion(next);
  }, []);

  const closeSuggestion = useCallback(() => {
    if (suggestionRef.current) {
      update(null);
    }
  }, [update]);

  const refreshSuggestion = useCallback(() => {
    const editor = editorRef.current;

    if (!editor || editor.isDestroyed || fileOptionsRef.current.length === 0) {
      closeSuggestion();
      return;
    }

    const { selection } = editor.state;
    const { $from } = selection;

    if (!selection.empty || !$from.parent.isTextblock || editor.isActive("codeBlock") || editor.isActive("code")) {
      closeSuggestion();
      return;
    }

    const textBefore = $from.parent.textBetween(
      Math.max(0, $from.parentOffset - MAX_QUERY_LENGTH),
      $from.parentOffset,
      undefined,
      "￼"
    );
    const match = TRIGGER_PATTERN.exec(textBefore);

    if (!match) {
      closeSuggestion();
      return;
    }

    const query = match[1];
    const options = filterVaultFileOptions(fileOptionsRef.current, query, MAX_VISIBLE_OPTIONS);

    // No match means no popup at all, so Enter and the arrow keys keep their
    // usual meaning while the user types something that is not a file name.
    if (options.length === 0) {
      closeSuggestion();
      return;
    }

    const previous = suggestionRef.current;
    const keptIndex = previous && previous.query === query ? previous.activeIndex : 0;
    const from = $from.pos - match[0].length;
    const coords = editor.view.coordsAtPos(from);

    update({
      from,
      to: $from.pos,
      query,
      options,
      activeIndex: Math.min(keptIndex, options.length - 1),
      coords: { left: coords.left, top: coords.top, bottom: coords.bottom }
    });
  }, [closeSuggestion, editorRef, update]);

  const selectSuggestion = useCallback(
    (option: VaultFileOption) => {
      const current = suggestionRef.current;

      if (!current) {
        return;
      }

      update(null);
      onSelect(option, { from: current.from, to: current.to });
    },
    [onSelect, update]
  );

  const setActiveIndex = useCallback(
    (index: number) => {
      const current = suggestionRef.current;

      if (current) {
        update({ ...current, activeIndex: index });
      }
    },
    [update]
  );

  /** Returns true when the key belonged to the popup and must not reach the document. */
  const handleSuggestionKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      const current = suggestionRef.current;

      if (!current) {
        return false;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();

        const offset = event.key === "ArrowDown" ? 1 : -1;
        update({
          ...current,
          activeIndex: (current.activeIndex + offset + current.options.length) % current.options.length
        });
        return true;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectSuggestion(current.options[current.activeIndex]);
        return true;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeSuggestion();
        return true;
      }

      return false;
    },
    [closeSuggestion, selectSuggestion, update]
  );

  return {
    suggestion,
    refreshSuggestion,
    closeSuggestion,
    selectSuggestion,
    setActiveIndex,
    handleSuggestionKeyDown
  };
}
