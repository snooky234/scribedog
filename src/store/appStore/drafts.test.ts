import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  writeDraft: vi.fn(async () => undefined),
  deleteDraft: vi.fn(async () => undefined),
  moveDraft: vi.fn(async () => undefined),
  moveFolderDrafts: vi.fn(async () => undefined),
  deleteFolderDrafts: vi.fn(async () => undefined),
  loadDrafts: vi.fn(async () => [] as unknown[])
}));

vi.mock("@/lib/drafts", () => storage);
vi.mock("@/platform/paths", () => ({
  join: async (...parts: string[]) => parts.join("/"),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")),
  normalize: async (path: string) => path
}));

const {
  DRAFT_WRITE_DELAY_MS,
  deleteFolderDraftsFor,
  discardDraft,
  flushDrafts,
  hasPendingDrafts,
  loadDraftDocuments,
  moveDraftFor,
  moveFolderDraftsFor,
  scheduleDraft
} = await import("./drafts");

const VAULT = "D:/Vault";
const NOTE = "D:/Vault/Notes/Idea.md";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  await flushDrafts();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("scheduleDraft", () => {
  // Vaults sit in Dropbox, Syncthing or Git: one write per keystroke would be
  // constant churn there, so only the last state after the pause goes out.
  it("writes once after the pause, with the last content and the relative path", async () => {
    scheduleDraft(VAULT, NOTE, "a", 100);
    scheduleDraft(VAULT, NOTE, "ab", 100);
    scheduleDraft(VAULT, NOTE, "abc", 100);

    expect(storage.writeDraft).not.toHaveBeenCalled();
    expect(hasPendingDrafts()).toBe(true);

    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);

    expect(storage.writeDraft).toHaveBeenCalledTimes(1);
    expect(storage.writeDraft).toHaveBeenCalledWith(VAULT, "Notes/Idea.md", "abc", 100);
    expect(hasPendingDrafts()).toBe(false);
  });

  it("does nothing without a vault", () => {
    scheduleDraft(null, NOTE, "a", null);

    expect(hasPendingDrafts()).toBe(false);
  });
});

describe("flushDrafts", () => {
  it("writes every pending draft at once and resolves when they are written", async () => {
    scheduleDraft(VAULT, NOTE, "one", null);
    scheduleDraft(VAULT, "D:/Vault/Other.md", "two", 5);

    await flushDrafts();

    expect(storage.writeDraft).toHaveBeenCalledTimes(2);
    expect(storage.writeDraft).toHaveBeenCalledWith(VAULT, "Other.md", "two", 5);
    expect(hasPendingDrafts()).toBe(false);

    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(storage.writeDraft).toHaveBeenCalledTimes(2);
  });
});

describe("discardDraft", () => {
  // Saved, or typed back to the baseline: a pending write would put a draft
  // on disk for a document that is clean.
  it("cancels the pending write and deletes the stored draft", async () => {
    scheduleDraft(VAULT, NOTE, "a", null);

    discardDraft(VAULT, NOTE);
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);

    expect(storage.writeDraft).not.toHaveBeenCalled();
    expect(storage.deleteDraft).toHaveBeenCalledWith(VAULT, "Notes/Idea.md");
  });
});

describe("moves and deletes", () => {
  it("commits a pending draft under the old path before moving it", async () => {
    scheduleDraft(VAULT, NOTE, "text", 1);

    moveDraftFor(VAULT, NOTE, "D:/Vault/Notes/Renamed.md");

    expect(storage.writeDraft).toHaveBeenCalledWith(VAULT, "Notes/Idea.md", "text", 1);
    expect(storage.moveDraft).toHaveBeenCalledWith(VAULT, "Notes/Idea.md", "Notes/Renamed.md");
    expect(storage.writeDraft.mock.invocationCallOrder[0]).toBeLessThan(
      storage.moveDraft.mock.invocationCallOrder[0]
    );
    expect(hasPendingDrafts()).toBe(false);
  });

  it("commits pending drafts under a moved folder, not those beside it", async () => {
    scheduleDraft(VAULT, NOTE, "inside", null);
    scheduleDraft(VAULT, "D:/Vault/Notesbook/Other.md", "beside", null);

    moveFolderDraftsFor(VAULT, "D:/Vault/Notes", "D:/Vault/Archive/Notes");

    expect(storage.writeDraft).toHaveBeenCalledTimes(1);
    expect(storage.writeDraft).toHaveBeenCalledWith(VAULT, "Notes/Idea.md", "inside", null);
    expect(storage.moveFolderDrafts).toHaveBeenCalledWith(VAULT, "Notes", "Archive/Notes");
    expect(hasPendingDrafts()).toBe(true);
  });

  it("drops pending drafts under a deleted folder", async () => {
    scheduleDraft(VAULT, NOTE, "gone", null);

    deleteFolderDraftsFor(VAULT, "D:/Vault/notes");
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);

    expect(storage.writeDraft).not.toHaveBeenCalled();
    expect(storage.deleteFolderDrafts).toHaveBeenCalledWith(VAULT, "notes");
  });
});

describe("loadDraftDocuments", () => {
  const files = [
    { filePath: "D:\\Vault\\Notes\\Idea.md", relativePath: "Notes/Idea.md", mtimeMs: 1 },
    { filePath: "D:\\Vault\\Same.md", relativePath: "Same.md", mtimeMs: 2 }
  ];
  const disk: Record<string, string> = {
    "D:\\Vault\\Notes\\Idea.md": "base",
    "D:\\Vault\\Same.md": "same"
  };
  const readFile = async (path: string) => {
    if (!(path in disk)) {
      throw new Error("ENOENT");
    }

    return disk[path];
  };

  it("restores a draft as a dirty document keyed by the file's own path", async () => {
    storage.loadDrafts.mockResolvedValueOnce([
      { relativePath: "notes/idea.md", content: "draft", baseMtimeMs: 1, updatedAt: 0 }
    ]);

    const documents = await loadDraftDocuments(VAULT, files, readFile);

    expect(documents).toEqual({
      "D:\\Vault\\Notes\\Idea.md": { content: "draft", baseContent: "base", baseMtimeMs: 1 }
    });
  });

  it("drops a draft whose file is gone and one equal to what is on disk", async () => {
    storage.loadDrafts.mockResolvedValueOnce([
      { relativePath: "Deleted.md", content: "x", baseMtimeMs: null, updatedAt: 0 },
      { relativePath: "Same.md", content: "same", baseMtimeMs: 2, updatedAt: 0 }
    ]);

    const documents = await loadDraftDocuments(VAULT, files, readFile);

    expect(documents).toEqual({});
    expect(storage.deleteDraft).toHaveBeenCalledWith(VAULT, "Deleted.md");
    expect(storage.deleteDraft).toHaveBeenCalledWith(VAULT, "Same.md");
  });

  // A folder note typed into but never saved has no file; its folder is what
  // has to be there.
  it("restores an unwritten folder note while its folder exists", async () => {
    storage.loadDrafts.mockResolvedValueOnce([
      { relativePath: "Notes/.scribedog-foldernote.md", content: "about notes", baseMtimeMs: null, updatedAt: 0 },
      { relativePath: ".scribedog-foldernote.md", content: "about the vault", baseMtimeMs: null, updatedAt: 0 },
      { relativePath: "Gone/.scribedog-foldernote.md", content: "orphan", baseMtimeMs: null, updatedAt: 0 }
    ]);

    const documents = await loadDraftDocuments(VAULT, files, readFile);

    expect(documents).toEqual({
      "D:/Vault/Notes/.scribedog-foldernote.md": { content: "about notes", baseContent: "", baseMtimeMs: null, baseVersion: null },
      "D:/Vault/.scribedog-foldernote.md": {
        content: "about the vault",
        baseContent: "",
        baseMtimeMs: null,
        baseVersion: null
      }
    });
    expect(storage.deleteDraft).toHaveBeenCalledWith(VAULT, "Gone/.scribedog-foldernote.md");
  });

  it("keeps a draft whose file cannot be read right now", async () => {
    storage.loadDrafts.mockResolvedValueOnce([
      { relativePath: "Locked.md", content: "x", baseMtimeMs: null, updatedAt: 0 }
    ]);

    const documents = await loadDraftDocuments(
      VAULT,
      [{ filePath: "D:\\Vault\\Locked.md", relativePath: "Locked.md", mtimeMs: 3 }],
      readFile
    );

    expect(documents).toEqual({});
    expect(storage.deleteDraft).not.toHaveBeenCalled();
  });
});
