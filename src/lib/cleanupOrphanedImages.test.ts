import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

/** Minimal in-memory vault: markdown files by absolute path. */
let files: Record<string, string> = {};
const removed: string[] = [];

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (path: string) => files[path] ?? ""),
  writeTextFile: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  exists: vi.fn(async () => true),
  mkdir: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  stat: vi.fn(async () => ({ mtime: new Date(0) })),
  remove: vi.fn(async (path: string) => {
    removed.push(path);
  }),
  readDir: vi.fn(async (path: string) => {
    const children = new Map<string, { name: string; isDirectory: boolean }>();

    for (const filePath of Object.keys(files)) {
      if (!filePath.startsWith(`${path}/`)) {
        continue;
      }

      const rest = filePath.slice(path.length + 1);
      const [head, ...tail] = rest.split("/");
      children.set(head, { name: head, isDirectory: tail.length > 0 });
    }

    return [...children.values()].map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory,
      isFile: !entry.isDirectory,
      isSymlink: false
    }));
  })
}));

const { cleanupImagesOfDeletedFiles, cleanupOrphanedImages } = await import("@/lib/fileSystem");
const { adoptPastedImageSource, holdClipboardImages } = await import("@/lib/clipboardImages");

const VAULT = "/vault";

beforeEach(() => {
  files = {};
  removed.length = 0;
  holdClipboardImages(null, []);
});

describe("cleanupOrphanedImages", () => {
  it("deletes an image that this note no longer references", async () => {
    files["/vault/note.md"] = "# Title\n";

    await cleanupOrphanedImages(VAULT, "/vault/note.md", "![x](images/a.png)", "# Title\n");

    expect(removed).toEqual(["/vault/images/a.png"]);
  });

  it("keeps an image that another note still references", async () => {
    files["/vault/note.md"] = "# Title\n";
    files["/vault/other.md"] = "![x](images/a.png)";

    await cleanupOrphanedImages(VAULT, "/vault/note.md", "![x](images/a.png)", "# Title\n");

    expect(removed).toEqual([]);
  });

  it("keeps an image that a note in a subfolder still references", async () => {
    files["/vault/note.md"] = "# Title\n";
    files["/vault/sub/other.md"] = "![x](../images/a.png)";

    await cleanupOrphanedImages(VAULT, "/vault/note.md", "![x](images/a.png)", "# Title\n");

    expect(removed).toEqual([]);
  });

  // Data-loss regression: a note that moved to the vault root while still
  // carrying "../images/x.png" resolves that reference outside the vault. It
  // then no longer matches the previous reference and looked like the image
  // had been removed from the note — so the image file was deleted.
  it("deletes nothing while the note still holds a reference pointing outside the vault", async () => {
    files["/vault/note.md"] = "![x](../images/a.png)";

    await cleanupOrphanedImages(
      VAULT,
      "/vault/note.md",
      "![x](images/a.png)",
      "![x](../images/a.png)"
    );

    expect(removed).toEqual([]);
  });

  it("ignores absolute URLs", async () => {
    files["/vault/note.md"] = "# Title\n";

    await cleanupOrphanedImages(
      VAULT,
      "/vault/note.md",
      "![x](https://example.com/a.png)",
      "# Title\n"
    );

    expect(removed).toEqual([]);
  });

  it("does not confuse the width title with the path", async () => {
    files["/vault/note.md"] = "# Title\n";

    await cleanupOrphanedImages(
      VAULT,
      "/vault/note.md",
      '![x](images/a.png "width=388")',
      "# Title\n"
    );

    expect(removed).toEqual(["/vault/images/a.png"]);
  });
});

describe("images on the clipboard", () => {
  // Regression: Ctrl+X on an image removed it from the note, the auto-save a
  // second later deleted the file, and the paste pointed at nothing.
  it("keeps an image that was cut out of the note being saved", async () => {
    files["/vault/note.md"] = "# Title\n";
    holdClipboardImages("/vault/note.md", ["images/a.png"]);

    await cleanupOrphanedImages(VAULT, "/vault/note.md", "![x](images/a.png)", "# Title\n");

    expect(removed).toEqual([]);
  });

  it("resolves the held image against the note it was cut from", async () => {
    files["/vault/sub/note.md"] = "# Title\n";
    holdClipboardImages("/vault/sub/note.md", ["../images/a.png"]);

    await cleanupOrphanedImages(VAULT, "/vault/sub/note.md", "![x](../images/a.png)", "# Title\n");

    expect(removed).toEqual([]);
  });

  it("deletes the image again once a later copy replaced it on the clipboard", async () => {
    files["/vault/note.md"] = "# Title\n";
    holdClipboardImages("/vault/note.md", ["images/a.png"]);
    holdClipboardImages("/vault/note.md", []);

    await cleanupOrphanedImages(VAULT, "/vault/note.md", "![x](images/a.png)", "# Title\n");

    expect(removed).toEqual(["/vault/images/a.png"]);
  });

  // Cut from one note, pasted into another, then deleted there: the paste
  // ended the protection, so the image goes with the note it now lives in.
  it("deletes the image again once it was pasted", async () => {
    files["/vault/note.md"] = "# Title\n";
    holdClipboardImages("/vault/note.md", ["images/a.png"]);
    adoptPastedImageSource("images/a.png", "/vault/other.md", VAULT);

    await cleanupOrphanedImages(VAULT, "/vault/other.md", "![x](images/a.png)", "");

    expect(removed).toEqual(["/vault/images/a.png"]);
  });

  it("spares only the held image, not the others removed with it", async () => {
    files["/vault/note.md"] = "# Title\n";
    holdClipboardImages("/vault/note.md", ["images/a.png"]);

    await cleanupOrphanedImages(
      VAULT,
      "/vault/note.md",
      "![x](images/a.png)\n![y](images/b.png)",
      "# Title\n"
    );

    expect(removed).toEqual(["/vault/images/b.png"]);
  });

  it("ignores a hold from a note of another vault", async () => {
    files["/vault/note.md"] = "# Title\n";
    holdClipboardImages("/other/note.md", ["../vault/images/a.png"]);

    await cleanupOrphanedImages(VAULT, "/vault/note.md", "![x](images/a.png)", "# Title\n");

    expect(removed).toEqual(["/vault/images/a.png"]);
  });
});

describe("unsaved notes", () => {
  // Pasted into a note that is not saved yet: on disk nothing refers to the
  // image any more, only the open note does.
  it("keeps an image that only the unsaved content of an open note references", async () => {
    files["/vault/note.md"] = "# Title\n";
    files["/vault/sub/other.md"] = "# Other\n";

    await cleanupOrphanedImages(VAULT, "/vault/note.md", "![x](images/a.png)", "# Title\n", [
      { filePath: "/vault/sub/other.md", markdown: "![x](../images/a.png)" }
    ]);

    expect(removed).toEqual([]);
  });

  it("does not count the unsaved content of the note being deleted", async () => {
    await cleanupOrphanedImages(VAULT, "/vault/note.md", "![x](images/a.png)", "", [
      { filePath: "/vault/note.md", markdown: "![x](images/a.png)" }
    ]);

    expect(removed).toEqual(["/vault/images/a.png"]);
  });

  it("keeps an image of a deleted folder that an open note outside it references", async () => {
    await cleanupImagesOfDeletedFiles(
      VAULT,
      [{ filePath: "/vault/sub/a.md", markdown: "![x](../images/a.png)" }],
      [{ filePath: "/vault/keep.md", markdown: "![x](images/a.png)" }]
    );

    expect(removed).toEqual([]);
  });
});

describe("cleanupImagesOfDeletedFiles", () => {
  // The folder is already gone from disk when the cleanup runs, so only the
  // notes outside it are in the in-memory vault.
  it("deletes the images of every note in a deleted folder", async () => {
    files["/vault/keep.md"] = "# Title\n";

    await cleanupImagesOfDeletedFiles(VAULT, [
      { filePath: "/vault/sub/a.md", markdown: "![x](../images/a.png)" },
      { filePath: "/vault/sub/deep/b.md", markdown: "![y](../../images/b.png)" }
    ]);

    expect(removed.sort()).toEqual(["/vault/images/a.png", "/vault/images/b.png"]);
  });

  it("keeps an image that a note outside the deleted folder still references", async () => {
    files["/vault/keep.md"] = "![x](images/a.png)";

    await cleanupImagesOfDeletedFiles(VAULT, [
      { filePath: "/vault/sub/a.md", markdown: "![x](../images/a.png)\n![y](../images/b.png)" }
    ]);

    expect(removed).toEqual(["/vault/images/b.png"]);
  });

  it("removes an image shared by two deleted notes once", async () => {
    await cleanupImagesOfDeletedFiles(VAULT, [
      { filePath: "/vault/sub/a.md", markdown: "![x](../images/a.png)" },
      { filePath: "/vault/sub/b.md", markdown: "![x](../images/a.png)" }
    ]);

    expect(removed).toEqual(["/vault/images/a.png"]);
  });
});
