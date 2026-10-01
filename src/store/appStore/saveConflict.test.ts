import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...segments: string[]) => segments.join("/"),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")) || "/"
}));

// The note as it sits on disk. The version token is derived from the content
// the way a hash would be: same text, same token.
const disk = vi.hoisted(() => ({
  content: "" as string | null,
  mtimeMs: 1_000,
  // Runs inside the write, to simulate the user typing while it is in flight.
  duringWrite: null as null | (() => void)
}));
const versionOf = (content: string) => `v:${content}`;

const fsMock = vi.hoisted(() => ({
  writeMarkdownFileIfMatch: vi.fn(async (_path: string, content: string, expected: string | null) => {
    const current = disk.content === null ? null : { content: disk.content, version: `v:${disk.content}` };

    if ((current?.version ?? null) !== expected) {
      return { ok: false as const, current };
    }

    disk.duringWrite?.();
    disk.content = content;
    disk.mtimeMs += 10_000;

    return { ok: true as const, version: `v:${content}` };
  }),
  readMarkdownFileVersioned: vi.fn(async () => ({ content: disk.content ?? "", version: `v:${disk.content}` })),
  readMarkdownFileVersion: vi.fn(async () => (disk.content === null ? null : `v:${disk.content}`)),
  readMarkdownFile: vi.fn(async () => disk.content ?? ""),
  readMarkdownFileMtime: vi.fn(async () => (disk.content === null ? null : disk.mtimeMs))
}));

vi.mock("@/lib/fileSystem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fileSystem")>()),
  ...fsMock,
  cleanupOrphanedImages: vi.fn(async () => undefined)
}));

const versioning = vi.hoisted(() => ({
  snapshotFileVersion: vi.fn(),
  snapshotFileVersionNow: vi.fn(async () => undefined)
}));

vi.mock("./versioning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./versioning")>()),
  ...versioning
}));

vi.mock("./drafts", () => ({
  discardDraft: vi.fn(),
  flushDrafts: vi.fn(async () => undefined),
  moveDraftFor: vi.fn(),
  scheduleDraft: vi.fn(),
  moveFolderDraftsFor: vi.fn(),
  deleteFolderDraftsFor: vi.fn(),
  loadDraftDocuments: vi.fn(async () => ({}))
}));

const { useAppStore } = await import("@/store/useAppStore");

const VAULT = "/vault";
const NOTE = "/vault/note.md";

const BASE = "# Note\n\nFirst paragraph.\n\nSecond paragraph.\n";
const MINE = BASE.replace("First paragraph.", "First paragraph, edited here.");

function openWith(
  content: string,
  { base = BASE, baseVersion = versionOf(BASE) }: { base?: string; baseVersion?: string | null } = {}
) {
  useAppStore.setState({
    folderPath: VAULT,
    filePaths: [NOTE],
    emptyFolderPaths: [],
    fileDocuments: { [NOTE]: { content, baseContent: base, baseMtimeMs: 1_000, baseVersion } },
    selectedFilePath: NOTE,
    selectedFileContent: content,
    selectedFileBaseContent: base,
    isDirty: content !== base,
    saveConflict: null,
    mergeReview: null,
    saveError: null,
    manualOrder: {}
  });
}

beforeEach(() => {
  disk.content = BASE;
  disk.mtimeMs = 1_000;
  disk.duringWrite = null;
  vi.clearAllMocks();
  openWith(MINE);
});

describe("saveSelectedFile with versions", () => {
  it("writes while the disk still holds the baseline, and adopts the new version and mtime", async () => {
    expect(await useAppStore.getState().saveSelectedFile()).toBe(true);

    expect(fsMock.writeMarkdownFileIfMatch).toHaveBeenCalledWith(NOTE, MINE, versionOf(BASE));
    const state = useAppStore.getState();
    expect(disk.content).toBe(MINE);
    expect(state.isDirty).toBe(false);
    expect(state.fileDocuments[NOTE]).toMatchObject({ baseContent: MINE, baseVersion: versionOf(MINE), baseMtimeMs: 11_000 });
    expect(state.fileMtimeMs[NOTE]).toBe(11_000);
  });

  it("merges someone else's change at another place silently and shows the result", async () => {
    disk.content = BASE.replace("Second paragraph.", "Second paragraph, edited elsewhere.");
    const merged = MINE.replace("Second paragraph.", "Second paragraph, edited elsewhere.");

    expect(await useAppStore.getState().saveSelectedFile({ trigger: "auto" })).toBe(true);

    const state = useAppStore.getState();
    expect(disk.content).toBe(merged);
    expect(state.saveConflict).toBeNull();
    expect(state.selectedFileContent).toBe(merged);
    expect(state.selectedFileBaseContent).toBe(merged);
    expect(state.isDirty).toBe(false);
    expect(state.fileDocuments[NOTE].baseVersion).toBe(versionOf(merged));
  });

  it("keeps keystrokes typed while a merged write was in flight", async () => {
    disk.content = BASE.replace("Second paragraph.", "Second paragraph, edited elsewhere.");
    const typedOn = `${MINE}\nThird paragraph.\n`;
    disk.duringWrite = () => useAppStore.getState().updateSelectedFileContent(typedOn);

    expect(await useAppStore.getState().saveSelectedFile()).toBe(true);

    const state = useAppStore.getState();
    const merged = MINE.replace("Second paragraph.", "Second paragraph, edited elsewhere.");
    expect(state.selectedFileBaseContent).toBe(merged);
    expect(state.selectedFileContent).toBe(`${merged}\nThird paragraph.\n`);
    expect(state.isDirty).toBe(true);
  });

  it("asks on a manual save when the changes overlap, and writes nothing", async () => {
    const theirs = BASE.replace("First paragraph.", "First paragraph, theirs.");
    disk.content = theirs;

    expect(await useAppStore.getState().saveSelectedFile()).toBe(false);

    const state = useAppStore.getState();
    expect(disk.content).toBe(theirs);
    expect(state.saveConflict).toEqual({
      filePath: NOTE,
      prompt: true,
      conflicts: 1,
      theirs: { content: theirs, version: versionOf(theirs) },
      ours: MINE,
      theirsText: theirs,
      oursText: MINE
    });
    expect(state.isDirty).toBe(true);
    expect(state.isSaving).toBe(false);
    expect(state.saveError).toBeNull();
  });

  // A timer must not open a dialog mid-sentence.
  it("only marks the note on an overlapping auto-save", async () => {
    disk.content = BASE.replace("First paragraph.", "First paragraph, theirs.");

    expect(await useAppStore.getState().saveSelectedFile({ trigger: "auto" })).toBe(false);

    expect(useAppStore.getState().saveConflict).toMatchObject({ filePath: NOTE, prompt: false });
    expect(useAppStore.getState().isDirty).toBe(true);
  });

  it("overwrites on force, with the disk version snapshotted first", async () => {
    const theirs = BASE.replace("First paragraph.", "First paragraph, theirs.");
    disk.content = theirs;
    await useAppStore.getState().saveSelectedFile();

    expect(await useAppStore.getState().saveSelectedFile({ force: true })).toBe(true);

    expect(versioning.snapshotFileVersionNow).toHaveBeenCalledWith(VAULT, NOTE, theirs);
    const writeOrder = fsMock.writeMarkdownFileIfMatch.mock.invocationCallOrder;
    const lastWrite = writeOrder[writeOrder.length - 1];
    expect(versioning.snapshotFileVersionNow.mock.invocationCallOrder[0]).toBeLessThan(lastWrite);
    expect(disk.content).toBe(MINE);
    expect(useAppStore.getState().saveConflict).toBeNull();
    expect(useAppStore.getState().isDirty).toBe(false);
  });

  it("dismissSaveConflict closes the question but keeps the conflict marked", async () => {
    disk.content = BASE.replace("First paragraph.", "First paragraph, theirs.");
    await useAppStore.getState().saveSelectedFile();

    useAppStore.getState().dismissSaveConflict();

    expect(useAppStore.getState().saveConflict).toMatchObject({ filePath: NOTE, prompt: false });
    expect(useAppStore.getState().isDirty).toBe(true);
  });

  // A note whose baseline nobody recorded a version for saves as before.
  it("writes over whatever is there without a baseline version", async () => {
    useAppStore.setState({
      fileDocuments: { [NOTE]: { content: MINE, baseContent: BASE, baseMtimeMs: 1_000 } }
    });
    disk.content = "# Something else entirely\n";

    expect(await useAppStore.getState().saveSelectedFile()).toBe(true);
    expect(disk.content).toBe(MINE);
  });

  it("writes a note again that was deleted meanwhile", async () => {
    disk.content = null;

    expect(await useAppStore.getState().saveSelectedFile()).toBe(true);
    expect(disk.content).toBe(MINE);
  });

  it("refuses to create over a file that appeared under a new note's name", async () => {
    openWith(MINE, { base: "", baseVersion: null });

    expect(await useAppStore.getState().saveSelectedFile()).toBe(false);
    expect(useAppStore.getState().saveConflict).toMatchObject({ filePath: NOTE });
    expect(disk.content).toBe(BASE);
  });
});

describe("resolving a conflict in the editor", () => {
  const THEIRS = BASE.replace("First paragraph.", "First paragraph, theirs.").replace(
    "Second paragraph.",
    "Second paragraph, theirs too."
  );

  beforeEach(async () => {
    disk.content = THEIRS;
    await useAppStore.getState().saveSelectedFile();
  });

  it("puts their version under the document, with their text at the overlap", async () => {
    expect(await useAppStore.getState().startMergeReview()).toBe(true);

    const state = useAppStore.getState();
    expect(versioning.snapshotFileVersionNow).toHaveBeenCalledWith(VAULT, NOTE, MINE);
    expect(state.saveConflict).toBeNull();
    expect(state.mergeReview).toEqual({ filePath: NOTE, theirsText: THEIRS, oursText: MINE.replace("Second paragraph.", "Second paragraph, theirs too.") });
    expect(state.selectedFileContent).toBe(THEIRS);
    expect(state.selectedFileBaseContent).toBe(THEIRS);
    expect(state.fileDocuments[NOTE].baseVersion).toBe(versionOf(THEIRS));
  });

  it("does not save while passages are open, and saves normally afterwards", async () => {
    await useAppStore.getState().startMergeReview();
    const resolved = useAppStore.getState().mergeReview!.oursText;
    useAppStore.getState().updateSelectedFileContent(resolved);

    expect(await useAppStore.getState().saveSelectedFile({ trigger: "auto" })).toBe(false);
    expect(disk.content).toBe(THEIRS);

    useAppStore.getState().endMergeReview();

    expect(await useAppStore.getState().saveSelectedFile()).toBe(true);
    expect(disk.content).toBe(resolved);
  });

  it("works the merge out again when the user typed on after it was found", async () => {
    useAppStore.getState().updateSelectedFileContent(`${MINE}\nMore.\n`);

    expect(await useAppStore.getState().startMergeReview()).toBe(false);

    expect(useAppStore.getState().mergeReview).toBeNull();
    expect(useAppStore.getState().saveConflict).toMatchObject({ ours: `${MINE}\nMore.\n` });
  });
});
