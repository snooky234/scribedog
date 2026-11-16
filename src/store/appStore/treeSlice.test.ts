import { beforeEach, describe, expect, it, vi } from "vitest";

// POSIX stand-ins for the Tauri path APIs, which would otherwise need the
// native shell. join() must resolve "." and ".." exactly like the real one
// ("joins ... then normalizes the resulting path") — the whole image rewrite
// depends on that, so a naive concatenating mock would hide the bugs it is
// supposed to catch.
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...segments: string[]) => {
    const isAbsolute = segments[0]?.startsWith("/");
    const parts: string[] = [];

    for (const segment of segments.join("/").split("/")) {
      if (!segment || segment === ".") {
        continue;
      }

      if (segment === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
        continue;
      }

      parts.push(segment);
    }

    return (isAbsolute ? "/" : "") + parts.join("/");
  },
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
  markdownFolderExists: vi.fn(async () => false),
  createMarkdownFolderAtPath: vi.fn(async () => undefined)
}));

vi.mock("@/lib/vaultMeta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vaultMeta")>()),
  writeManualOrder: vi.fn(async () => undefined),
  writeSortMode: vi.fn(async () => undefined)
}));

const { writeMarkdownFile, renameMarkdownFile, markdownFolderExists, createMarkdownFolderAtPath } = await import("@/lib/fileSystem");
const { useAppStore } = await import("@/store/useAppStore");

const VAULT = "/vault";
const NOTE = "/vault/note.md";
const MOVED_NOTE = "/vault/sub/note.md";
const MARKDOWN = "# Title\n\n![eye](images/image-3.png)\n";
const REWRITTEN = "# Title\n\n![eye](../images/image-3.png)\n";

function primeStore(
  document: { content: string; baseContent: string } | null,
  notePath = NOTE
) {
  useAppStore.setState({
    folderPath: VAULT,
    filePaths: [notePath],
    emptyFolderPaths: ["/vault/sub", "/vault/sub/deep", "/vault/other"],
    fileDocuments: document ? { [notePath]: document } : {},
    selectedFilePath: document ? notePath : null,
    selectedFileContent: document?.content ?? null,
    selectedFileBaseContent: document?.baseContent ?? null,
    manualOrder: {},
    isDirty: document ? document.content !== document.baseContent : false,
    fileError: null
  });
}

async function moveNote(sourcePath: string, targetParentDirectory: string) {
  return useAppStore.getState().moveTreeEntry({
    kind: "file",
    sourcePath,
    targetParentDirectory,
    targetIndex: 0
  });
}

async function moveNoteIntoSub() {
  return moveNote(NOTE, "/vault/sub");
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

  // The reverse direction: "../images/x.png" is only correct while the file
  // sits one level down. Moved back to the vault root it has to lose the
  // "../" again, otherwise it points outside the vault and cannot be read.
  it("rewrites the path back when a file moves out of a subfolder to the root", async () => {
    primeStore({ content: REWRITTEN, baseContent: REWRITTEN }, MOVED_NOTE);

    expect(await moveNote(MOVED_NOTE, VAULT)).toBe(true);

    expect(useAppStore.getState().fileDocuments[NOTE]).toEqual({
      content: MARKDOWN,
      baseContent: MARKDOWN
    });
    expect(writeMarkdownFile).toHaveBeenCalledWith(NOTE, MARKDOWN);
  });

  it("adds one \"../\" per level when a file moves into a nested folder", async () => {
    primeStore({ content: MARKDOWN, baseContent: MARKDOWN });

    expect(await moveNote(NOTE, "/vault/sub/deep")).toBe(true);

    expect(useAppStore.getState().fileDocuments["/vault/sub/deep/note.md"].baseContent).toBe(
      "# Title\n\n![eye](../../images/image-3.png)\n"
    );
  });

  it("leaves the path untouched when moving between folders at the same depth", async () => {
    primeStore({ content: REWRITTEN, baseContent: REWRITTEN }, MOVED_NOTE);

    expect(await moveNote(MOVED_NOTE, "/vault/other")).toBe(true);

    expect(useAppStore.getState().fileDocuments["/vault/other/note.md"].baseContent).toBe(REWRITTEN);
    expect(writeMarkdownFile).not.toHaveBeenCalled();
  });

  // A reference already pointing outside the vault (damage from a move made
  // before the rewrite reached disk) must not be "corrected" further -
  // prepending another "../" would push it even further out.
  it("leaves a reference that already points outside the vault untouched", async () => {
    const broken = "# Title\n\n![eye](../images/image-1.png)\n";
    primeStore({ content: broken, baseContent: broken });

    expect(await moveNoteIntoSub()).toBe(true);

    expect(useAppStore.getState().fileDocuments[MOVED_NOTE].baseContent).toBe(broken);
    expect(writeMarkdownFile).not.toHaveBeenCalled();
  });

  // The editor renders selectedFileContent, not fileDocuments — so correcting
  // only the map leaves the open document showing the old path. This is the
  // real-world case: insert an image into a note inside a folder (unsaved, so
  // baseContent has no image reference yet), then drag the note to the root.
  it("mirrors the corrected content into the selected-file fields", async () => {
    const savedState = "# Title\n";
    const withImage = "# Title\n\n![eye](../images/image-3.png)\n";
    primeStore({ content: withImage, baseContent: savedState }, MOVED_NOTE);

    expect(await moveNote(MOVED_NOTE, VAULT)).toBe(true);

    const state = useAppStore.getState();
    expect(state.selectedFilePath).toBe(NOTE);
    expect(state.selectedFileContent).toBe("# Title\n\n![eye](images/image-3.png)\n");
    expect(state.selectedFileBaseContent).toBe(savedState);
    expect(state.isDirty).toBe(true);
  });

  it("keeps the selected-file fields untouched when another file is moved", async () => {
    useAppStore.setState({
      folderPath: VAULT,
      filePaths: [NOTE, "/vault/other-note.md"],
      emptyFolderPaths: ["/vault/sub"],
      fileDocuments: { [NOTE]: { content: MARKDOWN, baseContent: MARKDOWN } },
      selectedFilePath: NOTE,
      selectedFileContent: MARKDOWN,
      selectedFileBaseContent: MARKDOWN,
      manualOrder: {},
      isDirty: false,
      fileError: null
    });

    expect(await moveNote("/vault/other-note.md", "/vault/sub")).toBe(true);

    const state = useAppStore.getState();
    expect(state.selectedFilePath).toBe(NOTE);
    expect(state.selectedFileContent).toBe(MARKDOWN);
    expect(state.isDirty).toBe(false);
  });

  it("does not write anything when the file has no relative image references", async () => {
    primeStore({ content: "# Plain\n", baseContent: "# Plain\n" });

    await moveNoteIntoSub();

    expect(writeMarkdownFile).not.toHaveBeenCalled();
  });
});

describe("convertFileToFolderNote", () => {
  const RECIPES = "/vault/Rezepte.md";
  const RECIPES_FOLDER = "/vault/Rezepte";
  const RECIPES_NOTE = "/vault/Rezepte/.scribedog-foldernote.md";

  function primeVault(filePaths: string[], document: { content: string; baseContent: string } | null) {
    useAppStore.setState({
      folderPath: VAULT,
      filePaths,
      emptyFolderPaths: [],
      fileDocuments: document ? { [RECIPES]: document } : {},
      selectedFilePath: document ? RECIPES : null,
      selectedFileContent: document?.content ?? null,
      selectedFileBaseContent: document?.baseContent ?? null,
      manualOrder: {},
      vaultIcons: {},
      workingSet: [],
      isDirty: document ? document.content !== document.baseContent : false,
      fileError: null
    });
  }

  beforeEach(() => {
    vi.mocked(renameMarkdownFile).mockClear();
    vi.mocked(createMarkdownFolderAtPath).mockClear();
    vi.mocked(markdownFolderExists).mockResolvedValue(false);
  });

  it("puts the note into a new folder of its name, in its place, with unsaved edits kept", async () => {
    primeVault(["/vault/Apfel.md", RECIPES, "/vault/Zitrone.md"], {
      content: "# Rezepte\n\nneu\n",
      baseContent: "# Rezepte\n"
    });

    expect(await useAppStore.getState().convertFileToFolderNote(RECIPES)).toBe(RECIPES_NOTE);

    const state = useAppStore.getState();
    expect(createMarkdownFolderAtPath).toHaveBeenCalledWith(RECIPES_FOLDER);
    expect(renameMarkdownFile).toHaveBeenNthCalledWith(1, RECIPES, "/vault/Rezepte/Rezepte.md");
    expect(renameMarkdownFile).toHaveBeenNthCalledWith(2, "/vault/Rezepte/Rezepte.md", RECIPES_NOTE);
    expect(state.filePaths).toContain(RECIPES_NOTE);
    expect(state.filePaths).not.toContain(RECIPES);
    expect(state.emptyFolderPaths).toEqual([]);
    expect(state.selectedFilePath).toBe(RECIPES_NOTE);
    expect(state.selectedFileContent).toBe("# Rezepte\n\nneu\n");
    expect(state.isDirty).toBe(true);
    expect(state.manualOrder[""]).toEqual(["Apfel.md", "Rezepte", "Zitrone.md"]);
    expect(state.fileError).toBeNull();
  });

  it("moves the note into an existing folder of that name without its own note", async () => {
    vi.mocked(markdownFolderExists).mockResolvedValue(true);
    primeVault([RECIPES, "/vault/Rezepte/Kuchen.md"], null);

    expect(await useAppStore.getState().convertFileToFolderNote(RECIPES)).toBe(RECIPES_NOTE);
    expect(createMarkdownFolderAtPath).not.toHaveBeenCalled();
    expect(useAppStore.getState().filePaths).toEqual(
      expect.arrayContaining([RECIPES_NOTE, "/vault/Rezepte/Kuchen.md"])
    );
  });

  it("refuses when the existing folder already has a folder note", async () => {
    vi.mocked(markdownFolderExists).mockResolvedValue(true);
    primeVault([RECIPES, RECIPES_NOTE], null);

    expect(await useAppStore.getState().convertFileToFolderNote(RECIPES)).toBeNull();
    expect(renameMarkdownFile).not.toHaveBeenCalled();
    expect(useAppStore.getState().fileError).not.toBeNull();
    expect(useAppStore.getState().filePaths).toContain(RECIPES);
  });

  it("carries the note's icon over to the folder", async () => {
    primeVault([RECIPES], null);
    useAppStore.setState({ vaultIcons: { "rezepte.md": "🍰" } });

    await useAppStore.getState().convertFileToFolderNote(RECIPES);

    expect(useAppStore.getState().vaultIcons).toEqual({ rezepte: "🍰" });
  });
});
