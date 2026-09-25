import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...segments: string[]) => segments.join("/"),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")) || "/"
}));

// A vault read that takes a while, like an HTTP round trip on a server vault.
const { readDelay, existingFolders } = vi.hoisted(() => ({
  readDelay: { promise: Promise.resolve() },
  existingFolders: new Set<string>()
}));

vi.mock("@/lib/fileSystem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fileSystem")>()),
  listMarkdownFiles: vi.fn(async (root: string) => [
    { filePath: `${root}/note.md`, relativePath: "note.md", mtimeMs: 1 },
    { filePath: `${root}/other.md`, relativePath: "other.md", mtimeMs: 1 }
  ]),
  readMarkdownFile: vi.fn(async (path: string) => {
    await readDelay.promise;
    return path.endsWith("other.md") ? "# Other, changed on disk\n" : "# Note\n";
  }),
  markdownFolderExists: vi.fn(async (path: string) => existingFolders.has(path))
}));

vi.mock("@/lib/vaultMeta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vaultMeta")>()),
  readSortMode: vi.fn(async () => "manual"),
  readManualOrder: vi.fn(async () => ({})),
  writeManualOrder: vi.fn(async () => undefined)
}));

const { useAppStore } = await import("@/store/useAppStore");

const VAULT = "/vault";
const NOTE = "/vault/note.md";
const OTHER = "/vault/other.md";

describe("refreshFolderFiles while the user is typing", () => {
  beforeEach(() => {
    useAppStore.setState({
      folderPath: VAULT,
      filePaths: [NOTE, OTHER],
      emptyFolderPaths: [],
      fileDocuments: {
        [NOTE]: { content: "# Note\n", baseContent: "# Note\n" },
        [OTHER]: { content: "# Other\n", baseContent: "# Other\n" }
      },
      selectedFilePath: NOTE,
      selectedFileContent: "# Note\n",
      selectedFileBaseContent: "# Note\n",
      isDirty: false,
      manualOrder: {}
    });
  });

  it("keeps keystrokes that arrive while the reads are in flight", async () => {
    let releaseReads!: () => void;
    readDelay.promise = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });

    const refresh = useAppStore.getState().refreshFolderFiles();

    // The watcher fired, the reads are on their way, and the user types.
    await Promise.resolve();
    useAppStore.getState().updateSelectedFileContent("# Note\n\ntyped meanwhile");
    expect(useAppStore.getState().isDirty).toBe(true);

    releaseReads();
    await refresh;

    const state = useAppStore.getState();
    expect(state.selectedFileContent).toBe("# Note\n\ntyped meanwhile");
    expect(state.fileDocuments[NOTE]).toEqual({ content: "# Note\n\ntyped meanwhile", baseContent: "# Note\n" });
    expect(state.isDirty).toBe(true);

    // The document nobody touched did pick up the change from disk.
    expect(state.fileDocuments[OTHER]).toEqual({
      content: "# Other, changed on disk\n",
      baseContent: "# Other, changed on disk\n",
      baseMtimeMs: 1
    });
  });

  it("follows a selection change made while the reads are in flight", async () => {
    let releaseReads!: () => void;
    readDelay.promise = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });

    const refresh = useAppStore.getState().refreshFolderFiles();
    await Promise.resolve();
    await useAppStore.getState().selectFilePath(OTHER);

    releaseReads();
    await refresh;

    expect(useAppStore.getState().selectedFilePath).toBe(OTHER);
  });
});

describe("refreshFolderFiles and empty folders", () => {
  beforeEach(() => {
    readDelay.promise = Promise.resolve();
    existingFolders.clear();
    useAppStore.setState({
      folderPath: VAULT,
      filePaths: [NOTE, OTHER],
      emptyFolderPaths: ["/vault/Kept", "/vault/Gone"],
      fileDocuments: {},
      selectedFilePath: null,
      selectedFileContent: null,
      selectedFileBaseContent: null,
      isDirty: false,
      manualOrder: {}
    });
  });

  it("drops an empty folder that was deleted outside the app", async () => {
    existingFolders.add("/vault/Kept");

    await useAppStore.getState().refreshFolderFiles();

    expect(useAppStore.getState().emptyFolderPaths).toEqual(["/vault/Kept"]);
  });

  it("keeps an empty folder created while the refresh was running", async () => {
    existingFolders.add("/vault/Kept");
    let releaseReads!: () => void;
    readDelay.promise = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    useAppStore.setState({
      fileDocuments: { [NOTE]: { content: "# Note\n", baseContent: "# Note\n" } }
    });

    const refresh = useAppStore.getState().refreshFolderFiles();
    await Promise.resolve();
    useAppStore.setState({
      emptyFolderPaths: [...useAppStore.getState().emptyFolderPaths, "/vault/Neu"]
    });

    releaseReads();
    await refresh;

    expect(useAppStore.getState().emptyFolderPaths).toEqual(["/vault/Kept", "/vault/Neu"]);
  });
});
