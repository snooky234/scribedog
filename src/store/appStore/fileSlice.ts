import { dirname, join } from "@/platform/paths";

import i18n from "@/i18n";
import {
  cleanupOrphanedImages,
  createMarkdownFolderAtPath,
  deleteMarkdownFile,
  getRelativeDisplayPath,
  readMarkdownFile,
  readMarkdownFileMtime,
  renameMarkdownFile,
  writeMarkdownFile
} from "@/lib/fileSystem";
import { readVersionContent } from "@/lib/fileVersions";
import { getFolderNotePath, isFolderNotePath } from "@/lib/folderNotes";

import { collectUnsavedDocuments, isDocumentDirty, isExternallyModified } from "./documents";
import { discardDraft, flushDrafts, moveDraftFor, scheduleDraft } from "./drafts";
import { toErrorMessage } from "./errors";
import { dropVaultIcons, moveVaultIcons } from "./icons";
import {
  currentChildBasenames,
  ensureManualOrderEntry,
  insertManualOrderEntry,
  persistManualOrderIfChanged,
  removeManualOrderEntry,
  renameManualOrderEntry,
  resolveManualOrderInsertIndex
} from "./manualOrder";
import {
  getBasename,
  insertFilePathSorted,
  INVALID_FILE_NAME_CHARS,
  isPathInsideFolder,
  normalizePathKey,
  resolveTargetDirectoryInVault
} from "./pathUtils";
import type { AppSlice, FileSlice } from "./types";
import { addWorkingSetEntry, hasWorkingSetEntry, remapWorkingSetPaths, removeWorkingSetEntry } from "./workingSet";
import { persistWorkingSet, shouldAutoAdmitWorkingSet } from "./workingSetSlice";
import {
  deleteFileVersionHistory,
  moveFileVersionHistory,
  snapshotFileVersion,
  snapshotFileVersionNow
} from "./versioning";

export const createFileSlice: AppSlice<FileSlice> = (set, get) => ({
  selectFilePath: async (filePath: string) => {
    // Leaving a note is one of the points where a pending draft goes out at once.
    void flushDrafts();

    const existingDocument = get().fileDocuments[filePath];

    if (existingDocument) {
      set({
        selectedFilePath: filePath,
        selectedFileContent: existingDocument.content,
        selectedFileBaseContent: existingDocument.baseContent,
        isFileLoading: false,
        isSaving: false,
        isDirty: existingDocument.content !== existingDocument.baseContent,
        fileError: null,
        saveError: null,
        saveConflict: null
      });

      return true;
    }

    set({
      selectedFilePath: filePath,
      selectedFileContent: null,
      selectedFileBaseContent: null,
      isFileLoading: true,
      isSaving: false,
      isDirty: false,
      fileError: null,
      saveError: null,
      saveConflict: null
    });

    try {
      // The mtime is read together with the content: it is what a later save
      // compares against to notice that someone else wrote the file meanwhile.
      const [markdown, baseMtimeMs] = await Promise.all([
        readMarkdownFile(filePath),
        readMarkdownFileMtime(filePath)
      ]);

      const currentState = get();
      const nextDocumentState = {
        content: markdown,
        baseContent: markdown,
        baseMtimeMs
      };

      if (currentState.selectedFilePath !== filePath) {
        set({
          fileDocuments: {
            ...currentState.fileDocuments,
            [filePath]: nextDocumentState
          }
        });

        return true;
      }

      set({
        fileDocuments: {
          ...currentState.fileDocuments,
          [filePath]: nextDocumentState
        },
        selectedFileContent: markdown,
        selectedFileBaseContent: markdown,
        isFileLoading: false,
        isSaving: false,
        isDirty: false,
        fileError: null,
        saveError: null
      });

      return true;
    } catch (error) {
      const currentState = get();

      if (currentState.selectedFilePath === filePath) {
        set({
          selectedFileContent: null,
          selectedFileBaseContent: null,
          isFileLoading: false,
          fileError: toErrorMessage(error, i18n.t("store.fileLoadError"))
        });
      }

      return false;
    }
  },
  openFolderNote: async (targetFolderPath: string) => {
    const notePath = getFolderNotePath(targetFolderPath);
    const { filePaths, fileDocuments } = get();
    // The list is the authority on how the path is spelled (separators,
    // case); the note is looked up through it rather than opened blind.
    const knownPath = filePaths.find(
      (path) => normalizePathKey(path) === normalizePathKey(notePath)
    );

    if (knownPath) {
      return get().selectFilePath(knownPath);
    }

    if (!fileDocuments[notePath]) {
      set({
        fileDocuments: {
          ...fileDocuments,
          [notePath]: { content: "", baseContent: "", baseMtimeMs: null }
        }
      });
    }

    return get().selectFilePath(notePath);
  },
  updateSelectedFileContent: (markdown: string) => {
    const { selectedFilePath, selectedFileBaseContent, fileDocuments, folderPath, workingSet } = get();

    if (!selectedFilePath) {
      return;
    }

    const currentDocument = fileDocuments[selectedFilePath];
    const baseContent = currentDocument?.baseContent ?? selectedFileBaseContent ?? markdown;
    // Carried, never looked up here: the mtime belongs to the moment the
    // baseline was read, and only the reader of the file knows it.
    const baseMtimeMs = currentDocument?.baseMtimeMs;
    const isDirty = markdown !== baseContent;
    // Becoming dirty is the one automatic way into the "In progress" list,
    // and only when the user has asked for that; by default pinning is the
    // only way in.
    const nextWorkingSet =
      isDirty && shouldAutoAdmitWorkingSet() && !hasWorkingSetEntry(workingSet, selectedFilePath)
        ? addWorkingSetEntry(workingSet, selectedFilePath)
        : workingSet;

    set({
      selectedFileContent: markdown,
      selectedFileBaseContent: baseContent,
      isDirty,
      fileDocuments: {
        ...fileDocuments,
        [selectedFilePath]: {
          content: markdown,
          baseContent,
          baseMtimeMs
        }
      },
      workingSet: nextWorkingSet,
      saveError: null
    });

    if (nextWorkingSet !== workingSet) {
      persistWorkingSet(folderPath, nextWorkingSet);
    }

    // The draft follows the dirty state: typed back to the baseline means
    // there is nothing to keep.
    if (markdown === baseContent) {
      discardDraft(folderPath, selectedFilePath);
    } else {
      scheduleDraft(folderPath, selectedFilePath, markdown, baseMtimeMs ?? null);
    }
  },
  // A markdown file can be written in more than one way for the same document
  // (loose lists, "*" vs "-" bullets, "1)" vs "1."), and the editor always
  // serializes the one canonical form. Without this, opening such a file
  // flagged it as unsaved before the user had typed a single character.
  // The file on disk stays untouched — only the in-memory baseline moves to
  // the canonical form, and only while the document is unmodified, so a real
  // edit can never be swallowed here.
  adoptCanonicalFileContent: (filePath: string, markdown: string) => {
    const { selectedFilePath, selectedFileContent, selectedFileBaseContent, fileDocuments } = get();
    const isSelected = filePath === selectedFilePath;
    const currentDocument = fileDocuments[filePath];
    const content = currentDocument?.content ?? (isSelected ? selectedFileContent : null);
    const baseContent = currentDocument?.baseContent ?? (isSelected ? selectedFileBaseContent : null);

    if (content === null || baseContent === null || content !== baseContent || markdown === baseContent) {
      return;
    }

    set({
      fileDocuments: {
        ...fileDocuments,
        [filePath]: {
          content: markdown,
          baseContent: markdown,
          baseMtimeMs: currentDocument?.baseMtimeMs
        }
      },
      ...(isSelected
        ? {
            selectedFileContent: markdown,
            selectedFileBaseContent: markdown,
            isDirty: false
          }
        : {})
    });
  },
  discardSelectedFileChanges: () => {
    const { selectedFilePath, selectedFileBaseContent, fileDocuments, folderPath } = get();

    if (!selectedFilePath || selectedFileBaseContent === null) {
      return false;
    }

    discardDraft(folderPath, selectedFilePath);

    set({
      selectedFileContent: selectedFileBaseContent,
      selectedFileBaseContent,
      isDirty: false,
      fileDocuments: {
        ...fileDocuments,
        [selectedFilePath]: {
          content: selectedFileBaseContent,
          baseContent: selectedFileBaseContent,
          baseMtimeMs: fileDocuments[selectedFilePath]?.baseMtimeMs
        }
      },
      saveError: null,
      saveConflict: null
    });

    return true;
  },
  saveSelectedFile: async (options) => {
    const { selectedFilePath } = get();

    if (!selectedFilePath) {
      return false;
    }

    return get().saveFilePath(selectedFilePath, options);
  },
  saveFilePath: async (filePath, options) => {
    const { selectedFilePath: openFilePath, selectedFileContent: openContent, folderPath, fileDocuments } = get();
    const previousDocument = fileDocuments[filePath];
    // The editor's own copy is the authority for the open note (the two are
    // kept in step, but this is the one the user sees).
    const selectedFileContent =
      filePath === openFilePath && openContent !== null ? openContent : previousDocument?.content ?? null;
    const selectedFilePath = filePath;

    if (selectedFileContent === null) {
      return false;
    }

    const previousBaseContent = previousDocument?.baseContent ?? selectedFileContent;

    set({ isSaving: true, saveError: null, saveConflict: null });

    try {
      const currentMtimeMs = await readMarkdownFileMtime(selectedFilePath);

      if (!options?.force && isExternallyModified(previousDocument?.baseMtimeMs, currentMtimeMs)) {
        // Someone else's version is on disk. A manual save asks; an
        // auto-save, which fires from a timer while the user types, must
        // not open a dialog, so it steps back and leaves the document dirty
        // (the draft carries it) until the next manual save.
        set({
          isSaving: false,
          saveConflict: options?.trigger === "auto" ? null : { filePath: selectedFilePath }
        });

        return false;
      }

      if (options?.force && currentMtimeMs !== null) {
        // The version being overwritten is the only copy of someone else's
        // work; it goes into the history before the write, so overwriting
        // is never destructive while versioning is on.
        const diskContent = await readMarkdownFile(selectedFilePath).catch(() => null);

        if (diskContent !== null && diskContent !== selectedFileContent) {
          await snapshotFileVersionNow(folderPath, selectedFilePath, diskContent);
        }
      }

      // A folder note is written into its folder on the first save; the
      // folder can still be one the agent has only proposed so far.
      if (isFolderNotePath(selectedFilePath)) {
        await createMarkdownFolderAtPath(await dirname(selectedFilePath));
      }

      await writeMarkdownFile(selectedFilePath, selectedFileContent);

      // What was just written is on disk; the draft has nothing left to protect.
      discardDraft(folderPath, selectedFilePath);

      // The mtime the write produced is the new baseline; without it every
      // following save would see its own write as someone else's change.
      const writtenMtimeMs = await readMarkdownFileMtime(selectedFilePath);

      snapshotFileVersion(folderPath, selectedFilePath, selectedFileContent, {
        throttle: options?.trigger === "auto"
      });

      if (folderPath) {
        void cleanupOrphanedImages(
          folderPath,
          selectedFilePath,
          previousBaseContent,
          selectedFileContent,
          collectUnsavedDocuments(get())
        ).catch(() => undefined);
      }

      const currentState = get();
      const currentDocument = currentState.fileDocuments[selectedFilePath];
      const nextSelectedContent =
        currentState.selectedFilePath === selectedFilePath
          ? currentState.selectedFileContent ?? selectedFileContent
          : currentDocument?.content ?? selectedFileContent;
      // The first save of a folder note (or of a note deleted outside the
      // app while it was open) is what brings the file into existence, so
      // the list learns about it here rather than on the next watcher tick.
      const isKnown = currentState.filePaths.some(
        (path) => normalizePathKey(path) === normalizePathKey(selectedFilePath)
      );

      set({
        ...(isKnown
          ? {}
          : {
              filePaths: insertFilePathSorted(currentState.filePaths, selectedFilePath)
            }),
        fileMtimeMs: {
          ...currentState.fileMtimeMs,
          [selectedFilePath]: writtenMtimeMs ?? Date.now()
        },
        fileDocuments: {
          ...currentState.fileDocuments,
          [selectedFilePath]: {
            content: nextSelectedContent,
            baseContent: selectedFileContent,
            baseMtimeMs: writtenMtimeMs
          }
        },
        selectedFileBaseContent:
          currentState.selectedFilePath === selectedFilePath
            ? selectedFileContent
            : currentState.selectedFileBaseContent,
        isSaving: false,
        isDirty:
          currentState.selectedFilePath === selectedFilePath
            ? nextSelectedContent !== selectedFileContent
            : currentState.isDirty,
        saveError: null
      });

      return true;
    } catch (error) {
      set({
        isSaving: false,
        saveError: toErrorMessage(error, i18n.t("store.fileSaveError"))
      });

      return false;
    }
  },
  dismissSaveConflict: () => {
    set({ saveConflict: null });
  },
  // Restoring writes the version's content into the open document and saves
  // it, which creates a *new* version on top of the history. Nothing in the
  // existing history is rewritten or removed, so a restore can itself be
  // undone by restoring the entry below it.
  restoreFileVersion: async (versionId: string) => {
    const { folderPath, selectedFilePath, isDirty } = get();

    if (!folderPath || !selectedFilePath) {
      return false;
    }

    try {
      const versionContent = await readVersionContent(folderPath, versionId);

      // Unsaved edits would otherwise be overwritten without ever having been
      // versioned. Saving them first puts them in the history too, so the
      // restore stays reversible in both directions.
      if (isDirty) {
        await get().saveSelectedFile();
      }

      if (get().selectedFilePath !== selectedFilePath) {
        return false;
      }

      get().updateSelectedFileContent(versionContent);

      return await get().saveSelectedFile();
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.versionRestoreError"))
      });

      return false;
    }
  },
  createNewFile: async (targetDirectory?: string, insertAfterBasename?: string | null) => {
    const { folderPath, filePaths, fileDocuments, emptyFolderPaths } = get();

    if (!folderPath) {
      return null;
    }

    try {
      const resolvedTargetDirectory = resolveTargetDirectoryInVault(folderPath, targetDirectory);

      const newFileBaseName = i18n.t("store.newFileBaseName");
      const existingPathKeys = new Set(filePaths.map(normalizePathKey));
      let newFilePath = await join(resolvedTargetDirectory, `${newFileBaseName}.md`);
      let suffix = 2;

      while (existingPathKeys.has(normalizePathKey(newFilePath))) {
        newFilePath = await join(resolvedTargetDirectory, `${newFileBaseName} ${suffix}.md`);
        suffix += 1;
      }

      await writeMarkdownFile(newFilePath, "");

      // The empty initial state is a version like any other: it is what
      // restoring "back to the beginning" has to land on.
      snapshotFileVersion(folderPath, newFilePath, "");

      const parentRelativePath = getRelativeDisplayPath(folderPath, resolvedTargetDirectory);
      const currentManualOrder = get().manualOrder;
      const seededManualOrder = ensureManualOrderEntry(
        currentManualOrder,
        parentRelativePath,
        currentChildBasenames(folderPath, filePaths, emptyFolderPaths, parentRelativePath)
      );
      const insertIndex = resolveManualOrderInsertIndex(
        seededManualOrder,
        parentRelativePath,
        insertAfterBasename
      );
      const nextManualOrder = insertManualOrderEntry(
        seededManualOrder,
        parentRelativePath,
        getBasename(newFilePath),
        insertIndex
      );
      persistManualOrderIfChanged(folderPath, currentManualOrder, nextManualOrder);

      set({
        filePaths: insertFilePathSorted(filePaths, newFilePath),
        manualOrder: nextManualOrder,
        fileDocuments: {
          ...fileDocuments,
          [newFilePath]: { content: "", baseContent: "" }
        },
        selectedFilePath: newFilePath,
        selectedFileContent: "",
        selectedFileBaseContent: "",
        isFileLoading: false,
        isSaving: false,
        isDirty: false,
        fileError: null,
        saveError: null
      });

      return newFilePath;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.fileCreateError"))
      });

      return null;
    }
  },
  // Copies a file next to itself, named after it with a localized "(Copy)"
  // suffix and numbered on collision — mirrors createNewFile's placement
  // logic but anchors the manual-order insert on the source file instead of
  // the current selection, and seeds the content from what's on screen when
  // the source is the open, possibly-unsaved document.
  duplicateFile: async (filePath: string) => {
    const { folderPath, filePaths, fileDocuments, emptyFolderPaths } = get();

    if (!folderPath) {
      return null;
    }

    try {
      const targetDirectory = await dirname(filePath);
      const sourceBasename = getBasename(filePath);
      const extensionIndex = sourceBasename.lastIndexOf(".");
      const sourceStem =
        extensionIndex === -1 ? sourceBasename : sourceBasename.slice(0, extensionIndex);
      const extension = extensionIndex === -1 ? "" : sourceBasename.slice(extensionIndex);
      const copySuffix = i18n.t("store.duplicateSuffix");

      const existingPathKeys = new Set(filePaths.map(normalizePathKey));
      let newFilePath = await join(targetDirectory, `${sourceStem} (${copySuffix})${extension}`);
      let suffix = 2;

      while (existingPathKeys.has(normalizePathKey(newFilePath))) {
        newFilePath = await join(
          targetDirectory,
          `${sourceStem} (${copySuffix} ${suffix})${extension}`
        );
        suffix += 1;
      }

      const content = fileDocuments[filePath]?.content ?? (await readMarkdownFile(filePath));

      await writeMarkdownFile(newFilePath, content);
      snapshotFileVersion(folderPath, newFilePath, content);

      const parentRelativePath = getRelativeDisplayPath(folderPath, targetDirectory);
      const currentManualOrder = get().manualOrder;
      const seededManualOrder = ensureManualOrderEntry(
        currentManualOrder,
        parentRelativePath,
        currentChildBasenames(folderPath, filePaths, emptyFolderPaths, parentRelativePath)
      );
      const insertIndex = resolveManualOrderInsertIndex(
        seededManualOrder,
        parentRelativePath,
        sourceBasename
      );
      const nextManualOrder = insertManualOrderEntry(
        seededManualOrder,
        parentRelativePath,
        getBasename(newFilePath),
        insertIndex
      );
      persistManualOrderIfChanged(folderPath, currentManualOrder, nextManualOrder);

      set({
        filePaths: insertFilePathSorted(filePaths, newFilePath),
        manualOrder: nextManualOrder,
        fileDocuments: {
          ...fileDocuments,
          [newFilePath]: { content, baseContent: content }
        },
        selectedFilePath: newFilePath,
        selectedFileContent: content,
        selectedFileBaseContent: content,
        isFileLoading: false,
        isSaving: false,
        isDirty: false,
        fileError: null,
        saveError: null
      });

      return newFilePath;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.fileDuplicateError"))
      });

      return null;
    }
  },
  // Creating a file the agent named, as part of applying a batch of staged
  // changes. Deliberately not createNewFile with a rename afterwards: that
  // would select the file, write an empty version first, and produce a rename
  // per created file in the version history.
  createFileAtPath: async (filePath: string, content: string) => {
    const { folderPath, filePaths, emptyFolderPaths } = get();

    if (!folderPath) {
      return false;
    }

    try {
      const targetDirectory = await dirname(filePath);

      // The agent may create "Projekte/2026/Notiz.md" without either folder
      // existing yet — mkdir is what makes that one tool call instead of three.
      await createMarkdownFolderAtPath(targetDirectory);
      await writeMarkdownFile(filePath, content);
      snapshotFileVersion(folderPath, filePath, content);
      // The document below starts clean; a draft left from an earlier life of
      // this path would come back dirty on the next open.
      discardDraft(folderPath, filePath);

      const parentRelativePath = getRelativeDisplayPath(folderPath, targetDirectory);
      const currentManualOrder = get().manualOrder;
      const seededManualOrder = ensureManualOrderEntry(
        currentManualOrder,
        parentRelativePath,
        currentChildBasenames(folderPath, filePaths, emptyFolderPaths, parentRelativePath)
      );
      const nextManualOrder = insertManualOrderEntry(
        seededManualOrder,
        parentRelativePath,
        getBasename(filePath),
        // At the end: a batch has no meaningful anchor to insert after, and the
        // user can drag it wherever they want afterwards.
        (seededManualOrder[parentRelativePath] ?? []).length
      );
      persistManualOrderIfChanged(folderPath, currentManualOrder, nextManualOrder);

      const currentState = get();
      const alreadyKnown = currentState.filePaths.some(
        (path) => normalizePathKey(path) === normalizePathKey(filePath)
      );

      // The created file can be the one on screen: the agent proposes it, the
      // user opens it to review the proposal, and applies from there. Without
      // mirroring into the selected-file fields the editor keeps the empty
      // document it was opened with, and that stale document wins the next time
      // anything writes back — the content shows up for a moment when the
      // folder watcher reloads it, and is then overwritten with nothing. Every
      // other mutating action in this slice does the same mirroring.
      const isSelected = currentState.selectedFilePath === filePath;

      set({
        filePaths: alreadyKnown
          ? currentState.filePaths
          : insertFilePathSorted(currentState.filePaths, filePath),
        manualOrder: nextManualOrder,
        fileDocuments: {
          ...currentState.fileDocuments,
          [filePath]: { content, baseContent: content }
        },
        ...(isSelected
          ? {
              selectedFileContent: content,
              selectedFileBaseContent: content,
              isDirty: false,
              isFileLoading: false
            }
          : {}),
        fileError: null
      });

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.fileCreateError"))
      });

      return false;
    }
  },
  // Optimistically registers files the import wrote to disk: adds them to
  // the tree and inserts them into the manual sort order under the folder
  // they actually landed in (mirroring createNewFile), without selecting
  // them or touching the open editor.
  registerImportedFiles: (
    importedFilePaths: string[],
    parentRelativePath: string,
    insertAfterBasename?: string | null
  ) => {
    const { folderPath } = get();

    if (!folderPath || importedFilePaths.length === 0) {
      return;
    }

    let nextFilePaths = get().filePaths;
    const existingPathKeys = new Set(nextFilePaths.map(normalizePathKey));
    const currentManualOrder = get().manualOrder;
    let nextManualOrder = ensureManualOrderEntry(
      currentManualOrder,
      parentRelativePath,
      currentChildBasenames(folderPath, nextFilePaths, get().emptyFolderPaths, parentRelativePath)
    );
    // Chains each subsequent file directly after the previous one, so the
    // whole imported batch lands together right after the chosen anchor.
    let anchorBasename = insertAfterBasename;

    for (const importedFilePath of importedFilePaths) {
      if (existingPathKeys.has(normalizePathKey(importedFilePath))) {
        continue;
      }

      existingPathKeys.add(normalizePathKey(importedFilePath));
      nextFilePaths = insertFilePathSorted(nextFilePaths, importedFilePath);

      const basename = getBasename(importedFilePath);
      const insertIndex = resolveManualOrderInsertIndex(nextManualOrder, parentRelativePath, anchorBasename);
      nextManualOrder = insertManualOrderEntry(nextManualOrder, parentRelativePath, basename, insertIndex);
      anchorBasename = basename;
    }

    persistManualOrderIfChanged(folderPath, currentManualOrder, nextManualOrder);

    set({
      filePaths: nextFilePaths,
      manualOrder: nextManualOrder
    });
  },
  renameSelectedFile: async (newBaseName: string) => {
    const { selectedFilePath } = get();

    if (!selectedFilePath) {
      return false;
    }

    return get().renameFilePath(selectedFilePath, newBaseName);
  },
  renameFilePath: async (filePath: string, newBaseName: string) => {
    const { filePaths, fileDocuments } = get();

    const trimmedBaseName = newBaseName.trim();

    if (!trimmedBaseName || INVALID_FILE_NAME_CHARS.test(trimmedBaseName)) {
      set({ fileError: i18n.t("store.invalidFileName") });
      return false;
    }

    try {
      const targetDirectory = await dirname(filePath);
      const newFilePath = await join(targetDirectory, `${trimmedBaseName}.md`);

      if (normalizePathKey(newFilePath) === normalizePathKey(filePath)) {
        return true;
      }

      const existingPathKeys = new Set(filePaths.map(normalizePathKey));

      if (existingPathKeys.has(normalizePathKey(newFilePath))) {
        set({ fileError: i18n.t("store.fileAlreadyExists") });
        return false;
      }

      await renameMarkdownFile(filePath, newFilePath);
      moveFileVersionHistory(get().folderPath, filePath, newFilePath);
      moveDraftFor(get().folderPath, filePath, newFilePath);

      const currentState = get();
      const nextDocuments = { ...currentState.fileDocuments };
      const movedDocument = nextDocuments[filePath] ?? fileDocuments[filePath];

      delete nextDocuments[filePath];

      if (movedDocument) {
        nextDocuments[newFilePath] = movedDocument;
      }

      let nextManualOrder = currentState.manualOrder;
      let nextVaultIcons = currentState.vaultIcons;

      if (currentState.folderPath) {
        const parentRelativePath = getRelativeDisplayPath(currentState.folderPath, targetDirectory);

        nextManualOrder = renameManualOrderEntry(
          nextManualOrder,
          parentRelativePath,
          getBasename(filePath),
          getBasename(newFilePath)
        );

        persistManualOrderIfChanged(currentState.folderPath, currentState.manualOrder, nextManualOrder);
        nextVaultIcons = moveVaultIcons(
          currentState.folderPath,
          currentState.vaultIcons,
          filePath,
          newFilePath
        );
      }

      const nextWorkingSet = remapWorkingSetPaths(currentState.workingSet, (path) =>
        path === filePath ? newFilePath : path
      );

      set({
        filePaths: insertFilePathSorted(
          currentState.filePaths.filter((path) => path !== filePath),
          newFilePath
        ),
        fileDocuments: nextDocuments,
        selectedFilePath:
          currentState.selectedFilePath === filePath
            ? newFilePath
            : currentState.selectedFilePath,
        manualOrder: nextManualOrder,
        vaultIcons: nextVaultIcons,
        workingSet: nextWorkingSet,
        fileError: null
      });

      if (nextWorkingSet !== currentState.workingSet) {
        persistWorkingSet(currentState.folderPath, nextWorkingSet);
      }

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.fileRenameError"))
      });

      return false;
    }
  },
  deleteFilePath: async (filePath: string) => {
    const { fileDocuments, selectedFilePath, folderPath } = get();

    try {
      // What was saved plus what was not: an image pasted into the note and
      // not saved yet is gone with it just the same.
      const openDocument = fileDocuments[filePath];
      const contentBeforeDelete = openDocument
        ? `${openDocument.baseContent}
${openDocument.content}`
        : await readMarkdownFile(filePath).catch(() => "");
      // A folder note that was opened but never saved has nothing on disk;
      // "deleting" it only closes the empty document.
      const isUnwrittenFolderNote =
        isFolderNotePath(filePath) &&
        !get().filePaths.some((path) => normalizePathKey(path) === normalizePathKey(filePath));

      if (!isUnwrittenFolderNote) {
        await deleteMarkdownFile(filePath);
      }

      deleteFileVersionHistory(folderPath, filePath);
      discardDraft(folderPath, filePath);

      if (folderPath) {
        void cleanupOrphanedImages(
          folderPath,
          filePath,
          contentBeforeDelete,
          "",
          collectUnsavedDocuments(get())
        ).catch(() => undefined);
      }

      const nextDocuments = { ...fileDocuments };
      delete nextDocuments[filePath];

      const isSelected = selectedFilePath === filePath;
      const currentState = get();
      const nextFilePaths = currentState.filePaths.filter((path) => path !== filePath);
      let nextEmptyFolderPaths = currentState.emptyFolderPaths;

      let nextManualOrder = currentState.manualOrder;
      let nextVaultIcons = currentState.vaultIcons;

      if (folderPath) {
        const parentDirectory = await dirname(filePath);
        const parentRelativePath = getRelativeDisplayPath(folderPath, parentDirectory);

        nextManualOrder = removeManualOrderEntry(nextManualOrder, parentRelativePath, getBasename(filePath));
        persistManualOrderIfChanged(folderPath, currentState.manualOrder, nextManualOrder);
        nextVaultIcons = dropVaultIcons(folderPath, currentState.vaultIcons, filePath);

        // Deleting a folder's note clears the folder's text, it does not
        // delete the folder — but the note may have been the only file that
        // put the folder in the tree, so the folder is kept as an empty one.
        const isFolderNowEmpty =
          isFolderNotePath(filePath) &&
          parentRelativePath !== "" &&
          !nextFilePaths.some((path) => isPathInsideFolder(path, parentDirectory)) &&
          !nextEmptyFolderPaths.some(
            (path) => normalizePathKey(path) === normalizePathKey(parentDirectory)
          );

        if (isFolderNowEmpty) {
          nextEmptyFolderPaths = [...nextEmptyFolderPaths, parentDirectory];
        }
      }

      const nextWorkingSet = removeWorkingSetEntry(currentState.workingSet, filePath);

      set({
        filePaths: nextFilePaths,
        emptyFolderPaths: nextEmptyFolderPaths,
        fileDocuments: nextDocuments,
        selectedFilePath: isSelected ? null : currentState.selectedFilePath,
        selectedFileContent: isSelected ? null : currentState.selectedFileContent,
        selectedFileBaseContent: isSelected ? null : currentState.selectedFileBaseContent,
        isDirty: isSelected ? false : currentState.isDirty,
        manualOrder: nextManualOrder,
        vaultIcons: nextVaultIcons,
        workingSet: nextWorkingSet,
        fileError: null
      });

      if (nextWorkingSet.length !== currentState.workingSet.length) {
        persistWorkingSet(folderPath, nextWorkingSet);
      }

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.fileDeleteError"))
      });

      return false;
    }
  },
  // Used by project-wide find & replace for files other than the selected
  // one. Files with unsaved in-memory edits get the replacement applied to
  // that in-memory content and stay dirty (nothing is silently saved);
  // everything else is written straight to disk.
  replaceFileContent: async (filePath: string, newContent: string) => {
    const { fileDocuments } = get();
    const existingDocument = fileDocuments[filePath];

    try {
      if (existingDocument && isDocumentDirty(existingDocument)) {
        set({
          fileDocuments: {
            ...get().fileDocuments,
            [filePath]: {
              content: newContent,
              baseContent: existingDocument.baseContent,
              baseMtimeMs: existingDocument.baseMtimeMs
            }
          }
        });
        scheduleDraft(get().folderPath, filePath, newContent, existingDocument.baseMtimeMs ?? null);
      } else {
        await writeMarkdownFile(filePath, newContent);

        // Project-wide replace overwrites files the user never opened, so
        // this is exactly the case a version history has to cover.
        snapshotFileVersion(get().folderPath, filePath, newContent);

        if (existingDocument) {
          set({
            fileDocuments: {
              ...get().fileDocuments,
              [filePath]: {
                content: newContent,
                baseContent: newContent
              }
            }
          });
        }
      }

      const currentState = get();

      if (currentState.selectedFilePath === filePath) {
        const updatedDocument = currentState.fileDocuments[filePath];

        set({
          selectedFileContent: updatedDocument?.content ?? newContent,
          selectedFileBaseContent: updatedDocument?.baseContent ?? newContent,
          isDirty: updatedDocument ? isDocumentDirty(updatedDocument) : false
        });
      }

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.fileSaveError"))
      });

      return false;
    }
  }
});
