import { beforeEach, describe, expect, it, vi } from "vitest";

const fileVersions = vi.hoisted(() => ({
  createFileVersion: vi.fn(async () => true),
  deleteFileVersions: vi.fn(async () => undefined),
  deleteFolderVersions: vi.fn(async () => undefined),
  moveFileVersions: vi.fn(async () => undefined),
  moveFolderVersions: vi.fn(async () => undefined)
}));

vi.mock("@/lib/fileVersions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fileVersions")>()),
  ...fileVersions
}));

vi.mock("@/lib/fileSystem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fileSystem")>()),
  getRelativeDisplayPath: (folderPath: string, filePath: string) => filePath.slice(folderPath.length + 1)
}));

const { useAppStore } = await import("@/store/useAppStore");
const { useVersioningSettingsStore } = await import("@/store/useVersioningSettingsStore");
const {
  deleteFileVersionHistory,
  deleteFolderVersionHistory,
  discardPendingFileVersion,
  flushPendingFileVersion,
  flushPendingFileVersions,
  moveFileVersionHistory,
  moveFolderVersionHistory,
  snapshotFileVersion
} = await import("./versioning");

const VAULT = "/vault";
const NOTE = "/vault/note.md";

/** Contents handed to createFileVersion, in call order. */
function writtenContents(): string[] {
  return fileVersions.createFileVersion.mock.calls.map((call) => (call as unknown[])[2] as string);
}

describe("versions under auto-save", () => {
  beforeEach(async () => {
    // Leftovers of the previous test must not leak into this one's calls.
    await flushPendingFileVersions();
    vi.clearAllMocks();
    useVersioningSettingsStore.setState({ versioningEnabled: true, maxVersionsPerFile: 20 });
  });

  it("takes no version while auto-saving, only the last state once the note is left", async () => {
    snapshotFileVersion(VAULT, NOTE, "one", { deferred: true });
    snapshotFileVersion(VAULT, NOTE, "two", { deferred: true });
    snapshotFileVersion(VAULT, NOTE, "three", { deferred: true });

    expect(fileVersions.createFileVersion).not.toHaveBeenCalled();

    await flushPendingFileVersion(NOTE);

    expect(fileVersions.createFileVersion).toHaveBeenCalledWith(VAULT, "note.md", "three", 20);
    expect(writtenContents()).toEqual(["three"]);

    // Leaving again without new edits takes nothing.
    await flushPendingFileVersion(NOTE);
    expect(fileVersions.createFileVersion).toHaveBeenCalledTimes(1);
  });

  it("lets a deliberate save replace the pending state instead of adding it", () => {
    snapshotFileVersion(VAULT, NOTE, "auto", { deferred: true });

    discardPendingFileVersion(NOTE);
    snapshotFileVersion(VAULT, NOTE, "manual");

    expect(writtenContents()).toEqual(["manual"]);
  });

  it("keeps the pending state ahead of another write to the note", () => {
    snapshotFileVersion(VAULT, NOTE, "typed", { deferred: true });
    snapshotFileVersion(VAULT, NOTE, "replaced across the vault");

    expect(writtenContents()).toEqual(["typed", "replaced across the vault"]);
  });

  it("carries the pending state along a rename and a folder move", async () => {
    snapshotFileVersion(VAULT, NOTE, "renamed", { deferred: true });
    moveFileVersionHistory(VAULT, NOTE, "/vault/new.md");

    await flushPendingFileVersion(NOTE);
    expect(fileVersions.createFileVersion).not.toHaveBeenCalled();

    moveFolderVersionHistory(VAULT, "/vault", "/vault/sub");
    await flushPendingFileVersion("/vault/sub/new.md");

    expect(fileVersions.createFileVersion).toHaveBeenCalledWith(VAULT, "sub/new.md", "renamed", 20);
  });

  it("drops the pending state of a deleted note or folder", async () => {
    snapshotFileVersion(VAULT, NOTE, "gone", { deferred: true });
    snapshotFileVersion(VAULT, "/vault/folder/inner.md", "gone too", { deferred: true });

    deleteFileVersionHistory(VAULT, NOTE);
    deleteFolderVersionHistory(VAULT, "/vault/folder");
    await flushPendingFileVersions();

    expect(fileVersions.createFileVersion).not.toHaveBeenCalled();
  });

  it("writes every pending note into its own vault on close or vault switch", async () => {
    snapshotFileVersion(VAULT, NOTE, "first", { deferred: true });
    snapshotFileVersion("/other", "/other/b.md", "second", { deferred: true });

    await flushPendingFileVersions();

    expect(fileVersions.createFileVersion).toHaveBeenCalledWith(VAULT, "note.md", "first", 20);
    expect(fileVersions.createFileVersion).toHaveBeenCalledWith("/other", "b.md", "second", 20);
  });

  it("takes nothing when versioning was turned off before the note was left", async () => {
    snapshotFileVersion(VAULT, NOTE, "pending", { deferred: true });
    useVersioningSettingsStore.setState({ versioningEnabled: false });

    await flushPendingFileVersion(NOTE);

    expect(fileVersions.createFileVersion).not.toHaveBeenCalled();
  });

  it("takes the version when the store selects another note, not on a rename", async () => {
    useAppStore.setState({ selectedFilePath: NOTE });
    snapshotFileVersion(VAULT, NOTE, "left behind", { deferred: true });

    // A rename moves the pending state first, then the selection.
    moveFileVersionHistory(VAULT, NOTE, "/vault/renamed.md");
    useAppStore.setState({ selectedFilePath: "/vault/renamed.md" });
    expect(fileVersions.createFileVersion).not.toHaveBeenCalled();

    useAppStore.setState({ selectedFilePath: "/vault/other.md" });

    expect(fileVersions.createFileVersion).toHaveBeenCalledWith(VAULT, "renamed.md", "left behind", 20);
    useAppStore.setState({ selectedFilePath: null });
  });
});
