import { dirname, join } from "@tauri-apps/api/path";

import i18n from "@/i18n";
import {
  cleanupOrphanedImages,
  deleteMarkdownFile,
  getRelativeDisplayPath,
  readMarkdownFile,
  renameMarkdownFile,
  writeMarkdownFile
} from "@/lib/fileSystem";

import { isDocumentDirty } from "./documents";
import { toErrorMessage } from "./errors";
import {
  appendManualOrderEntry,
  persistManualOrderIfChanged,
  removeManualOrderEntry,
  renameManualOrderEntry
} from "./manualOrder";
import {
  getBasename,
  insertFilePathSorted,
  INVALID_FILE_NAME_CHARS,
  normalizePathKey
} from "./pathUtils";
import type { AppSlice, FileSlice } from "./types";

export const createFileSlice: AppSlice<FileSlice> = (set, get) => ({
  selectFilePath: async (filePath: string) => {
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
        saveError: null
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
      saveError: null
    });

    try {
      const markdown = await readMarkdownFile(filePath);

      const currentState = get();
      const nextDocumentState = {
        content: markdown,
        baseContent: markdown
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
  updateSelectedFileContent: (markdown: string) => {
    const { selectedFilePath, selectedFileBaseContent, fileDocuments } = get();

    if (!selectedFilePath) {
      return;
    }

    const currentDocument = fileDocuments[selectedFilePath];
    const baseContent = currentDocument?.baseContent ?? selectedFileBaseContent ?? markdown;

    set({
      selectedFileContent: markdown,
      selectedFileBaseContent: baseContent,
      isDirty: markdown !== baseContent,
      fileDocuments: {
        ...fileDocuments,
        [selectedFilePath]: {
          content: markdown,
          baseContent
        }
      },
      saveError: null
    });
  },
  discardSelectedFileChanges: () => {
    const { selectedFilePath, selectedFileBaseContent, fileDocuments } = get();

    if (!selectedFilePath || selectedFileBaseContent === null) {
      return false;
    }

    set({
      selectedFileContent: selectedFileBaseContent,
      selectedFileBaseContent,
      isDirty: false,
      fileDocuments: {
        ...fileDocuments,
        [selectedFilePath]: {
          content: selectedFileBaseContent,
          baseContent: selectedFileBaseContent
        }
      },
      saveError: null
    });

    return true;
  },
  saveSelectedFile: async () => {
    const { selectedFilePath, selectedFileContent, folderPath, fileDocuments } = get();

    if (!selectedFilePath || selectedFileContent === null) {
      return false;
    }

    const previousBaseContent = fileDocuments[selectedFilePath]?.baseContent ?? selectedFileContent;

    set({ isSaving: true, saveError: null });

    try {
      await writeMarkdownFile(selectedFilePath, selectedFileContent);

      if (folderPath) {
        void cleanupOrphanedImages(
          folderPath,
          selectedFilePath,
          previousBaseContent,
          selectedFileContent
        ).catch(() => undefined);
      }

      const currentState = get();
      const currentDocument = currentState.fileDocuments[selectedFilePath];
      const nextSelectedContent =
        currentState.selectedFilePath === selectedFilePath
          ? currentState.selectedFileContent ?? selectedFileContent
          : currentDocument?.content ?? selectedFileContent;

      set({
        fileDocuments: {
          ...currentState.fileDocuments,
          [selectedFilePath]: {
            content: nextSelectedContent,
            baseContent: selectedFileContent
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
  createNewFile: async (targetDirectory?: string) => {
    const { folderPath, selectedFilePath, filePaths, fileDocuments } = get();

    if (!folderPath) {
      return null;
    }

    try {
      const resolvedTargetDirectory =
        targetDirectory ?? (selectedFilePath ? await dirname(selectedFilePath) : folderPath);

      const newFileBaseName = i18n.t("store.newFileBaseName");
      const existingPathKeys = new Set(filePaths.map(normalizePathKey));
      let newFilePath = await join(resolvedTargetDirectory, `${newFileBaseName}.md`);
      let suffix = 2;

      while (existingPathKeys.has(normalizePathKey(newFilePath))) {
        newFilePath = await join(resolvedTargetDirectory, `${newFileBaseName} ${suffix}.md`);
        suffix += 1;
      }

      await writeMarkdownFile(newFilePath, "");

      const parentRelativePath = getRelativeDisplayPath(folderPath, resolvedTargetDirectory);
      const currentManualOrder = get().manualOrder;
      const nextManualOrder = appendManualOrderEntry(
        currentManualOrder,
        parentRelativePath,
        getBasename(newFilePath)
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
  // Optimistically registers files the import wrote to the vault root: adds
  // them to the tree and appends them to the manual sort order (mirroring
  // createNewFile), without selecting them or touching the open editor.
  registerImportedFiles: (importedFilePaths: string[]) => {
    const { folderPath } = get();

    if (!folderPath || importedFilePaths.length === 0) {
      return;
    }

    let nextFilePaths = get().filePaths;
    const existingPathKeys = new Set(nextFilePaths.map(normalizePathKey));
    const currentManualOrder = get().manualOrder;
    let nextManualOrder = currentManualOrder;

    for (const importedFilePath of importedFilePaths) {
      if (existingPathKeys.has(normalizePathKey(importedFilePath))) {
        continue;
      }

      existingPathKeys.add(normalizePathKey(importedFilePath));
      nextFilePaths = insertFilePathSorted(nextFilePaths, importedFilePath);
      nextManualOrder = appendManualOrderEntry(nextManualOrder, "", getBasename(importedFilePath));
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

      const currentState = get();
      const nextDocuments = { ...currentState.fileDocuments };
      const movedDocument = nextDocuments[filePath] ?? fileDocuments[filePath];

      delete nextDocuments[filePath];

      if (movedDocument) {
        nextDocuments[newFilePath] = movedDocument;
      }

      let nextManualOrder = currentState.manualOrder;

      if (currentState.folderPath) {
        const parentRelativePath = getRelativeDisplayPath(currentState.folderPath, targetDirectory);

        nextManualOrder = renameManualOrderEntry(
          nextManualOrder,
          parentRelativePath,
          getBasename(filePath),
          getBasename(newFilePath)
        );

        persistManualOrderIfChanged(currentState.folderPath, currentState.manualOrder, nextManualOrder);
      }

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
        fileError: null
      });

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
      const contentBeforeDelete =
        fileDocuments[filePath]?.baseContent ?? (await readMarkdownFile(filePath).catch(() => ""));

      await deleteMarkdownFile(filePath);

      if (folderPath) {
        void cleanupOrphanedImages(folderPath, filePath, contentBeforeDelete, "").catch(() => undefined);
      }

      const nextDocuments = { ...fileDocuments };
      delete nextDocuments[filePath];

      const isSelected = selectedFilePath === filePath;
      const currentState = get();

      let nextManualOrder = currentState.manualOrder;

      if (folderPath) {
        const parentDirectory = await dirname(filePath);
        const parentRelativePath = getRelativeDisplayPath(folderPath, parentDirectory);

        nextManualOrder = removeManualOrderEntry(nextManualOrder, parentRelativePath, getBasename(filePath));
        persistManualOrderIfChanged(folderPath, currentState.manualOrder, nextManualOrder);
      }

      set({
        filePaths: currentState.filePaths.filter((path) => path !== filePath),
        fileDocuments: nextDocuments,
        selectedFilePath: isSelected ? null : currentState.selectedFilePath,
        selectedFileContent: isSelected ? null : currentState.selectedFileContent,
        selectedFileBaseContent: isSelected ? null : currentState.selectedFileBaseContent,
        isDirty: isSelected ? false : currentState.isDirty,
        manualOrder: nextManualOrder,
        fileError: null
      });

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
              baseContent: existingDocument.baseContent
            }
          }
        });
      } else {
        await writeMarkdownFile(filePath, newContent);

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
