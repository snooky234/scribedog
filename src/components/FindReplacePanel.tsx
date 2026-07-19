import { useEffect, useMemo, useRef, useState } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, Replace, WholeWord, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TextSelection } from "@tiptap/pm/state";
import type { Editor as TipTapEditor } from "@tiptap/react";

import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  ReplaceConfirmDialog,
  type ReplaceFileGroup
} from "@/components/ReplaceConfirmDialog";
import { getRelativeDisplayPath, readMarkdownFile } from "@/lib/fileSystem";
import { updateSearchHighlight } from "@/lib/searchHighlight";
import {
  applyTextReplacements,
  buildSearchRegex,
  findMatchesInDoc,
  findMatchesInText,
  type DocMatch,
  type TextMatch
} from "@/lib/textSearch";
import { useAppStore } from "@/store/useAppStore";
import { useSearchStore } from "@/store/useSearchStore";

type FindReplacePanelProps = {
  editor: TipTapEditor;
  folderPath: string | null;
  filePath: string | null;
  onClose: () => void;
  // Routed through App so the regular unsaved-changes dialog guards the
  // switch, exactly like clicking the file in the sidebar.
  onRequestFileOpen?: (filePath: string) => void;
};

type OtherFileResult = {
  filePath: string;
  fileLabel: string;
  content: string;
  matches: TextMatch[];
};

type ConfirmState = {
  groups: ReplaceFileGroup[];
  docMatches: DocMatch[];
  otherFiles: OtherFileResult[];
};

const ALL_FILES_SEARCH_DEBOUNCE_MS = 250;

export function FindReplacePanel({
  editor,
  folderPath,
  filePath,
  onClose,
  onRequestFileOpen
}: FindReplacePanelProps) {
  const { t } = useTranslation();
  const open = useSearchStore((state) => state.isPanelOpen);
  const focusRequestId = useSearchStore((state) => state.focusRequestId);
  const query = useSearchStore((state) => state.query);
  const replaceText = useSearchStore((state) => state.replaceText);
  const caseSensitive = useSearchStore((state) => state.caseSensitive);
  const wholeWord = useSearchStore((state) => state.wholeWord);
  const allFiles = useSearchStore((state) => state.allFiles);
  const pendingTarget = useSearchStore((state) => state.pendingTarget);
  const setQuery = useSearchStore((state) => state.setQuery);
  const setReplaceText = useSearchStore((state) => state.setReplaceText);
  const setCaseSensitive = useSearchStore((state) => state.setCaseSensitive);
  const setWholeWord = useSearchStore((state) => state.setWholeWord);
  const setAllFiles = useSearchStore((state) => state.setAllFiles);
  const setFileMatchCounts = useSearchStore((state) => state.setFileMatchCounts);
  const setPendingTarget = useSearchStore((state) => state.setPendingTarget);
  const [activeIndex, setActiveIndex] = useState(0);
  const [docVersion, setDocVersion] = useState(0);
  const [refreshId, setRefreshId] = useState(0);
  const [otherFileResults, setOtherFileResults] = useState<OtherFileResult[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [rulerMarks, setRulerMarks] = useState<Array<{ fraction: number; active: boolean }>>([]);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const options = useMemo(
    () => ({ caseSensitive, wholeWord }),
    [caseSensitive, wholeWord]
  );

  const docMatches = useMemo(() => {
    if (!open) {
      return [];
    }

    const regex = buildSearchRegex(query, options);
    return regex ? findMatchesInDoc(editor.state.doc, regex) : [];
    // docVersion re-runs this after every document change while the panel
    // is open (see the editor "update" subscription below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, open, query, options, docVersion]);

  const clampedActiveIndex = docMatches.length === 0 ? 0 : Math.min(activeIndex, docMatches.length - 1);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleUpdate = () => setDocVersion((version) => version + 1);

    editor.on("update", handleUpdate);

    return () => {
      editor.off("update", handleUpdate);
    };
  }, [editor, open]);

  // Keeps the inline highlight decorations in sync with the panel state.
  // The plugin recomputes matches on document changes by itself, so only
  // query/options/active-match changes need to be pushed here.
  useEffect(() => {
    updateSearchHighlight(
      editor,
      open && query ? { query, options, activeIndex: clampedActiveIndex } : null
    );
  }, [editor, open, query, options, clampedActiveIndex]);

  useEffect(() => {
    if (open) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [open, focusRequestId]);

  // A new query or option set restarts navigation at the first match and
  // clears the last replace summary.
  useEffect(() => {
    setActiveIndex(0);
    setResultMessage(null);
  }, [query, options, allFiles]);

  // Project-wide search across every other markdown file of the vault,
  // debounced so typing doesn't re-read the folder on each keystroke.
  // In-memory (possibly unsaved) content wins over the on-disk state.
  useEffect(() => {
    if (!open || !allFiles || !query || !folderPath) {
      setOtherFileResults([]);
      return;
    }

    let isStale = false;

    const handle = window.setTimeout(async () => {
      const regex = buildSearchRegex(query, options);

      if (!regex) {
        setOtherFileResults([]);
        return;
      }

      const { filePaths, fileDocuments } = useAppStore.getState();
      const results: OtherFileResult[] = [];

      for (const path of filePaths) {
        if (path === filePath) {
          continue;
        }

        let content: string;

        try {
          content = fileDocuments[path]?.content ?? (await readMarkdownFile(path));
        } catch {
          continue;
        }

        if (isStale) {
          return;
        }

        const matches = findMatchesInText(content, regex);

        if (matches.length > 0) {
          results.push({
            filePath: path,
            fileLabel: getRelativeDisplayPath(folderPath, path),
            content,
            matches
          });
        }
      }

      if (!isStale) {
        setOtherFileResults(results);
      }
    }, ALL_FILES_SEARCH_DEBOUNCE_MS);

    return () => {
      isStale = true;
      window.clearTimeout(handle);
    };
  }, [open, allFiles, query, options, folderPath, filePath, refreshId]);

  // Publishes the per-file match counts (current file included) for the
  // sidebar badges.
  useEffect(() => {
    if (!open || !allFiles || !query) {
      setFileMatchCounts({});
      return;
    }

    const counts: Record<string, number> = {};

    if (filePath && docMatches.length > 0) {
      counts[filePath] = docMatches.length;
    }

    for (const result of otherFileResults) {
      counts[result.filePath] = result.matches.length;
    }

    setFileMatchCounts(counts);
  }, [open, allFiles, query, filePath, docMatches, otherFileResults, setFileMatchCounts]);

  // Overview-ruler marks behind the editor scrollbar: one tick per match,
  // placed at the match's vertical position relative to the full document
  // height, so it lines up with where the scrollbar thumb has to go.
  useEffect(() => {
    if (!open || docMatches.length === 0) {
      setRulerMarks([]);
      return;
    }

    const viewport = editor.view.dom.closest(".editor-view__scroll");

    if (!(viewport instanceof HTMLElement)) {
      setRulerMarks([]);
      return;
    }

    const computeMarks = () => {
      const viewportRect = viewport.getBoundingClientRect();
      const scrollHeight = viewport.scrollHeight;

      if (scrollHeight <= 0) {
        return;
      }

      setRulerMarks(
        docMatches.map((match, index) => {
          const coords = editor.view.coordsAtPos(match.from);
          const contentY = coords.top - viewportRect.top + viewport.scrollTop;

          return {
            fraction: Math.min(1, Math.max(0, contentY / scrollHeight)),
            active: index === clampedActiveIndex
          };
        })
      );
    };

    computeMarks();

    // Zoom or window resizing reflows the document and shifts every match's
    // vertical position.
    const observer = new ResizeObserver(computeMarks);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [editor, open, docMatches, clampedActiveIndex]);

  const goToMatch = (index: number) => {
    if (docMatches.length === 0) {
      return;
    }

    const nextIndex = (index + docMatches.length) % docMatches.length;
    const match = docMatches[nextIndex];

    setActiveIndex(nextIndex);
    // Moves the (unfocused) editor selection to the match so closing the
    // panel with Enter continues right there — focus stays in the panel.
    editor.commands.command(({ tr }) => {
      tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
      tr.scrollIntoView();
      return true;
    });
    // ProseMirror's own scrollIntoView doesn't reliably reach the match
    // inside the custom ScrollArea viewport, so the match element is
    // scrolled into view directly via the DOM as well.
    const { node } = editor.view.domAtPos(match.from);
    const element = node instanceof HTMLElement ? node : node.parentElement;
    element?.scrollIntoView({ block: "center" });
  };

  // After a cross-file jump the panel remounts inside the newly opened
  // file's editor; the stored target says which match to continue at.
  useEffect(() => {
    if (!open || !pendingTarget || pendingTarget.filePath !== filePath || docMatches.length === 0) {
      return;
    }

    const targetIndex =
      pendingTarget.matchIndex < 0
        ? docMatches.length - 1
        : Math.min(pendingTarget.matchIndex, docMatches.length - 1);

    setPendingTarget(null);
    goToMatch(targetIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingTarget, filePath, docMatches]);

  const jumpToOtherFile = (result: OtherFileResult, matchIndex: number) => {
    if (!onRequestFileOpen) {
      return;
    }

    setPendingTarget({ filePath: result.filePath, matchIndex });
    onRequestFileOpen(result.filePath);
  };

  const canJumpToOtherFiles = allFiles && otherFileResults.length > 0 && Boolean(onRequestFileOpen);

  const goToNextMatch = () => {
    if (clampedActiveIndex + 1 < docMatches.length) {
      goToMatch(clampedActiveIndex + 1);
      return;
    }

    if (canJumpToOtherFiles) {
      jumpToOtherFile(otherFileResults[0], 0);
      return;
    }

    goToMatch(0);
  };

  const goToPreviousMatch = () => {
    if (clampedActiveIndex > 0) {
      goToMatch(clampedActiveIndex - 1);
      return;
    }

    if (canJumpToOtherFiles) {
      jumpToOtherFile(otherFileResults[otherFileResults.length - 1], -1);
      return;
    }

    goToMatch(docMatches.length - 1);
  };

  const otherMatchCount = otherFileResults.reduce((sum, result) => sum + result.matches.length, 0);
  const totalMatchCount = docMatches.length + (allFiles ? otherMatchCount : 0);
  const hasNavigableMatches = docMatches.length > 0 || canJumpToOtherFiles;

  const openReplaceConfirm = () => {
    if (totalMatchCount === 0) {
      return;
    }

    const groups: ReplaceFileGroup[] = [];

    if (docMatches.length > 0) {
      groups.push({
        filePath: filePath ?? "",
        fileLabel:
          folderPath && filePath
            ? getRelativeDisplayPath(folderPath, filePath)
            : t("findReplace.currentFile"),
        items: docMatches.map((match, index) => ({
          id: `doc:${index}`,
          before: match.before,
          text: match.text,
          after: match.after
        }))
      });
    }

    if (allFiles) {
      for (const result of otherFileResults) {
        groups.push({
          filePath: result.filePath,
          fileLabel: result.fileLabel,
          items: result.matches.map((match, index) => ({
            id: `${result.filePath}::${index}`,
            before: match.before,
            text: match.text,
            after: match.after
          }))
        });
      }
    }

    setConfirmState({ groups, docMatches, otherFiles: allFiles ? otherFileResults : [] });
  };

  const applyConfirmedReplacements = async (selectedIds: Set<string>) => {
    const state = confirmState;

    if (!state) {
      return;
    }

    setConfirmState(null);

    let replacedCount = 0;
    let changedFileCount = 0;

    const selectedDocMatches = state.docMatches.filter((_, index) => selectedIds.has(`doc:${index}`));

    // All replacements in the open document happen in one transaction, so a
    // single undo restores every one of them.
    if (selectedDocMatches.length > 0) {
      editor.commands.command(({ tr }) => {
        for (const match of [...selectedDocMatches].sort((left, right) => right.from - left.from)) {
          tr.insertText(replaceText, match.from, match.to);
        }

        return true;
      });

      replacedCount += selectedDocMatches.length;
      changedFileCount += 1;
    }

    const replaceFileContent = useAppStore.getState().replaceFileContent;

    for (const result of state.otherFiles) {
      const selectedMatches = result.matches.filter((_, index) =>
        selectedIds.has(`${result.filePath}::${index}`)
      );

      if (selectedMatches.length === 0) {
        continue;
      }

      const newContent = applyTextReplacements(result.content, selectedMatches, replaceText);
      const didReplace = await replaceFileContent(result.filePath, newContent);

      if (didReplace) {
        replacedCount += selectedMatches.length;
        changedFileCount += 1;
      }
    }

    setActiveIndex(0);
    setRefreshId((id) => id + 1);
    setResultMessage(
      t("findReplace.resultSummary", { matches: replacedCount, files: changedFileCount })
    );
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();

      if (event.shiftKey) {
        goToPreviousMatch();
      } else {
        goToNextMatch();
      }
    }
  };

  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="find-panel"
        role="search"
        aria-label={t("findReplace.panelLabel")}
        onKeyDown={handlePanelKeyDown}
      >
        <div className="find-panel__row">
          <input
            ref={searchInputRef}
            className="find-panel__input"
            type="text"
            value={query}
            placeholder={t("findReplace.searchPlaceholder")}
            aria-label={t("findReplace.searchPlaceholder")}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <span className="find-panel__counter" aria-live="polite">
            {query
              ? docMatches.length > 0
                ? t("findReplace.matchCount", {
                    current: clampedActiveIndex + 1,
                    total: docMatches.length
                  })
                : t("findReplace.noMatches")
              : null}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={t("findReplace.previousMatch")}
            title={t("findReplace.previousMatch")}
            disabled={!hasNavigableMatches}
            onClick={goToPreviousMatch}
          >
            <ChevronUp />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={t("findReplace.nextMatch")}
            title={t("findReplace.nextMatch")}
            disabled={!hasNavigableMatches}
            onClick={goToNextMatch}
          >
            <ChevronDown />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={onClose}
          >
            <X />
          </Button>
        </div>

        <div className="find-panel__row">
          <input
            className="find-panel__input"
            type="text"
            value={replaceText}
            placeholder={t("findReplace.replacePlaceholder")}
            aria-label={t("findReplace.replacePlaceholder")}
            spellCheck={false}
            onChange={(event) => setReplaceText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                openReplaceConfirm();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={totalMatchCount === 0}
            onClick={openReplaceConfirm}
          >
            <Replace aria-hidden="true" />
            {t("findReplace.replaceButton")}
          </Button>
        </div>

        <div className="find-panel__row find-panel__row--options">
          <Toggle
            pressed={caseSensitive}
            aria-label={t("findReplace.caseSensitive")}
            title={t("findReplace.caseSensitive")}
            onClick={() => setCaseSensitive(!caseSensitive)}
          >
            <CaseSensitive />
          </Toggle>
          <Toggle
            pressed={wholeWord}
            aria-label={t("findReplace.wholeWord")}
            title={t("findReplace.wholeWord")}
            onClick={() => setWholeWord(!wholeWord)}
          >
            <WholeWord />
          </Toggle>
          <label className="find-panel__all-files">
            <input
              type="checkbox"
              checked={allFiles}
              onChange={(event) => setAllFiles(event.target.checked)}
            />
            {t("findReplace.allFiles")}
          </label>
        </div>

        {allFiles && query ? (
          <p className="find-panel__summary" aria-live="polite">
            {t("findReplace.allFilesSummary", {
              matches: otherMatchCount,
              files: otherFileResults.length
            })}
          </p>
        ) : null}

        {resultMessage ? (
          <p className="find-panel__summary find-panel__summary--result" aria-live="polite">
            {resultMessage}
          </p>
        ) : null}
      </div>

      {rulerMarks.length > 0 ? (
        <div className="find-ruler" aria-hidden="true">
          {rulerMarks.map((mark, index) => (
            <span
              key={index}
              className={mark.active ? "find-ruler__mark find-ruler__mark--active" : "find-ruler__mark"}
              style={{ top: `${mark.fraction * 100}%` }}
            />
          ))}
        </div>
      ) : null}

      <ReplaceConfirmDialog
        open={confirmState !== null}
        groups={confirmState?.groups ?? []}
        replacement={replaceText}
        onConfirm={(selectedIds) => void applyConfirmedReplacements(selectedIds)}
        onCancel={() => setConfirmState(null)}
      />
    </>
  );
}
