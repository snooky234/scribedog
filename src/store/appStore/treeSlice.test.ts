import { beforeEach, describe, expect, it, vi } from "vitest";

// POSIX stand-ins for the Tauri path APIs, which would otherwise need the
// native shell.
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...segments: string[]) => segments.filter(Boolean).join("/"),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")) || "/"
}));

// Only the disk-touching functions are replaced; getRelativeDisplayPath,
// getRelativeImageMarkdownPath and rewriteRelativeImagePaths stay real, since
// they are exactly what this test exercises.
vi.mock("@/lib/fileSystem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fileSystem")>()),
  readMarkdownFile: vi.fn(async () => ""),
  writeMarkdownFile: vi.fn(async () => undefined),
  renameMarkdownFile: vi.fn(async () => undefined),
  renameMarkdownFolder: vi.fn(async () => undefined),
  markdownFolderExists: vi.fn(async () => false)
}));

vi.mock("@/lib/vaultMeta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vaultMeta")>()),
  writeManualOrder: vi.fn(async () => undefined),
  writeSortMode: vi.fn(async () => undefined)
}));

const { writeMarkdownFile, renameMarkdownFile } = await import("@/lib/fileSystem");
const { useAppStore } = await import("@/store/useAppStore");

const VAULT = "/vault";
const NOTE = "/vault/note.md";
const MOVED_NOTE = "/vault/sub/note.md";
const MARKDOWN = "# Title\n\n![eye](images/image-3.png)\n";
const REWRITTEN = "# Title\n\n![eye](../images/image-3.png)\n";

function primeStore(document: { content: string; baseContent: string } | null) {
  useAppStore.setState({
    folderPath: VAULT,
    filePaths: [NOTE],
    emptyFolderPaths: ["/vault/sub"],
    fileDocuments: document ? { [NOTE]: document } : {},
    selectedFilePath: document ? NOTE : null,
    selectedFileContent: document?.content ?? null,
    selectedFileBaseContent: document?.baseContent ?? null,
    manualOrder: {},
    isDirty: document ? document.content !== document.baseContent : false,
    fileError: null
  });
}

async function moveNoteIntoSub() {
  return useAppStore.getState().moveTreeEntry({
    kind: "file",
    sourcePath: NOTE,
    targetParentDirectory: "/vault/sub",
    targetIndex: 0
  });
}

describe("moveTreeEntry image path rewriting", () => {
  beforeEach(() => {
    vi.mocked(writeMarkdownFile).mockClear();
    vi.mocked(renameMarkdownFile).mockClear();
  });

  it("rewrites the relative image path when a file moves into a subfolder", async () => {
    primeStore({ content: MARKDOWN, baseContent: MARKDOWN });

    expect(await moveNoteIntoSub()).toBe(true);
    expect(renameMarkdownFile).toHaveBeenCalledWith(NOTE, MOVED_NOTE);
    expect(useAppStore.getState().fileDocuments[MOVED_NOTE]).toEqual({
      content: REWRITTEN,
      baseContent: REWRITTEN
    });
  });

  // Regression: the rewrite used to happen in memory only for files that had
  // been opened at least once. Since the document stays clean, nothing would
  // ever save it, and the folder watcher's refresh reloads clean documents
  // from disk — silently restoring the broken path.
  it("persists the rewritten path for an already-opened file", async () => {
    primeStore({ content: MARKDOWN, baseContent: MARKDOWN });

    await moveNoteIntoSub();

    expect(writeMarkdownFile).toHaveBeenCalledWith(MOVED_NOTE, REWRITTEN);
  });

  it("keeps unsaved edits unsaved while still persisting the corrected base content", async () => {
    const edited = MARKDOWN + "\nunsaved edit\n";
    primeStore({ content: edited, baseContent: MARKDOWN });

    await moveNoteIntoSub();

    // Only the on-disk state is corrected; the unsaved edit is not written.
    expect(writeMarkdownFile).toHaveBeenCalledTimes(1);
    expect(writeMarkdownFile).toHaveBeenCalledWith(MOVED_NOTE, REWRITTEN);

    const moved = useAppStore.getState().fileDocuments[MOVED_NOTE];
    expect(moved.baseContent).toBe(REWRITTEN);
    expect(moved.content).toBe(REWRITTEN + "\nunsaved edit\n");
    expect(moved.content).not.toBe(moved.baseContent);
  });

  it("does not write anything when the file has no relative image references", async () => {
    primeStore({ content: "# Plain\n", baseContent: "# Plain\n" });

    await moveNoteIntoSub();

    expect(writeMarkdownFile).not.toHaveBeenCalled();
  });
});
