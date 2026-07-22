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

const { cleanupOrphanedImages } = await import("@/lib/fileSystem");

const VAULT = "/vault";

beforeEach(() => {
  files = {};
  removed.length = 0;
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
