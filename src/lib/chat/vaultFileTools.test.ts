import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StagedChange } from "./vaultStaging";

// A fake vault: the tools only ever reach the filesystem through these two
// stores and readMarkdownFile, so this is the whole outside world they see.
const vault = vi.hoisted(() => ({
  files: new Map<string, string>(),
  staged: [] as StagedChange[],
  selectedFilePath: null as string | null
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/")
}));

vi.mock("@/lib/fileSystem", () => ({
  getRelativeDisplayPath: (root: string, filePath: string) =>
    filePath.replace(/\\/g, "/").startsWith(`${root}/`) ? filePath.replace(/\\/g, "/").slice(root.length + 1) : filePath,
  readMarkdownFile: async (filePath: string) => {
    const content = vault.files.get(filePath);

    if (content === undefined) {
      throw new Error("not found");
    }

    return content;
  }
}));

vi.mock("@/store/useAppStore", () => ({
  useAppStore: {
    getState: () => ({
      folderPath: "/vault",
      filePaths: [...vault.files.keys()],
      fileDocuments: {},
      selectedFilePath: vault.selectedFilePath,
      createFolderAtPath: async () => true
    }),
    setState: () => undefined
  }
}));

vi.mock("@/store/useStagedChangesStore", () => ({
  useStagedChangesStore: {
    getState: () => ({
      changes: vault.staged,
      changeFor: (relativePath: string) =>
        vault.staged.find(
          (change) =>
            change.path.toLowerCase() === relativePath.toLowerCase() ||
            change.targetPath.toLowerCase() === relativePath.toLowerCase()
        ),
      stage: (change: StagedChange) => {
        const existing = vault.staged.findIndex(
          (entry) =>
            (entry.path || entry.targetPath).toLowerCase() ===
            (change.path || change.targetPath).toLowerCase()
        );

        if (existing === -1) {
          vault.staged.push(change);
        } else {
          vault.staged[existing] = { ...vault.staged[existing], ...change };
        }
      }
    })
  }
}));

const { executeFileTool, findPassage, outlineOf, setAgentCapabilities } = await import(
  "./vaultFileTools"
);

beforeEach(() => {
  vault.files.clear();
  vault.staged = [];
  vault.selectedFilePath = null;
  // What a turn with the consent switches on looks like. The module defaults to
  // no file access at all, so this is also the state every test but the
  // capability ones below has to set up explicitly.
  setAgentCapabilities({ fileAccess: true, allowDelete: true });
});

function addFile(relativePath: string, content: string) {
  vault.files.set(`/vault/${relativePath}`, content);
}

describe("findPassage", () => {
  it("finds an exact passage and counts its occurrences", () => {
    expect(findPassage("eins zwei eins", "eins")).toEqual({ start: 0, end: 4, occurrences: 2 });
  });

  // old_text comes from a model quoting a file it read; an exact indexOf alone
  // sends it into a retry loop over a passage it identified perfectly well.
  it("tolerates differing whitespace", () => {
    const match = findPassage("Ein  Satz\n  über  Otter.", "Ein Satz über Otter.");

    expect(match).not.toBeNull();
    expect(match && "Ein  Satz\n  über  Otter.".slice(match.start, match.end)).toBe(
      "Ein  Satz\n  über  Otter."
    );
  });

  it("answers null for a passage that is not there", () => {
    expect(findPassage("abc", "xyz")).toBeNull();
    expect(findPassage("abc", "")).toBeNull();
  });
});

describe("outlineOf", () => {
  it("lists headings with their level and line number", () => {
    expect(outlineOf("# Eins\ntext\n\n## Zwei\n### Drei")).toEqual([
      { level: 1, title: "Eins", line: 1 },
      { level: 2, title: "Zwei", line: 4 },
      { level: 3, title: "Drei", line: 5 }
    ]);
  });

  // A "# comment" inside a shell snippet is not a heading.
  it("ignores everything inside a code fence", () => {
    expect(outlineOf("# Echt\n```sh\n# nur ein Kommentar\n```\n## Auch echt")).toEqual([
      { level: 1, title: "Echt", line: 1 },
      { level: 2, title: "Auch echt", line: 5 }
    ]);
  });
});

describe("search_files", () => {
  beforeEach(() => {
    addFile("Notiz.md", "Otter am Fluss\nnichts hier\nnoch ein Otter");
    addFile("Projekte/Plan.md", "Der Otter-Plan\nZeile zwei");
  });

  it("reports hits as path:line with the matching line", async () => {
    const result = await executeFileTool("search_files", { query: "Otter" });

    expect(result?.content).toContain("Notiz.md:1");
    expect(result?.content).toContain("Notiz.md:3");
    expect(result?.content).toContain("Projekte/Plan.md:1");
  });

  it("searches literally unless regex is set", async () => {
    const literal = await executeFileTool("search_files", { query: "Otter.*Plan" });
    expect(literal?.content).toContain("No hit");

    const regex = await executeFileTool("search_files", { query: "Otter.*Plan", regex: true });
    expect(regex?.content).toContain("Projekte/Plan.md:1");
  });

  it("narrows by glob", async () => {
    const result = await executeFileTool("search_files", { query: "Otter", glob: "Projekte/" });

    expect(result?.content).toContain("Projekte/Plan.md");
    expect(result?.content).not.toContain("Notiz.md:");
  });

  it("caps at max_results and says so", async () => {
    const result = await executeFileTool("search_files", { query: "Otter", max_results: 1 });

    expect(result?.content).toContain("cut off at 1 hits");
  });

  // An invalid pattern is something the model fixes on its next attempt, so it
  // is a retryable error carrying the engine's own message — not a crash.
  it("reports an invalid regex as retryable", async () => {
    const result = await executeFileTool("search_files", { query: "([unclosed", regex: true });

    expect(result?.retryable).toBe(true);
    expect(result?.content.startsWith("Error:")).toBe(true);
    expect(result?.content).toContain("regex");
  });

  it("suggests other wording when nothing matches", async () => {
    const result = await executeFileTool("search_files", { query: "Walross" });

    expect(result?.content).toContain("No hit");
    expect(result?.retryable).toBe(true);
  });
});

describe("the file tools' guards", () => {
  beforeEach(() => {
    addFile("Notiz.md", "Otter am Fluss");
  });

  // Two mechanisms editing one document is the bug nobody can reproduce: the
  // editor's widgets and a staged whole-file replacement are built against
  // different versions of the text.
  it("refuses the open document and points at the passage tools", async () => {
    vault.selectedFilePath = "/vault/Notiz.md";

    const result = await executeFileTool("write_file", { path: "Notiz.md", content: "neu" });

    expect(result?.content).toContain("replace_passage");
    expect(vault.staged).toHaveLength(0);
  });

  it("refuses a path outside the vault", async () => {
    const result = await executeFileTool("read_file", { path: "../../secret.md" });

    expect(result?.content).toContain("Error:");
    expect(result?.retryable).toBe(true);
  });

  it("refuses the vault's own metadata folder", async () => {
    const result = await executeFileTool("read_file", { path: ".scribedog/chat-sessions.json" });

    expect(result?.content).toContain("Error:");
  });

  it("stages a new file rather than writing it", async () => {
    const result = await executeFileTool("write_file", { path: "Ideen.md", content: "- eins" });

    expect(result?.content).toContain("OK:");
    expect(vault.files.has("/vault/Ideen.md")).toBe(false);
    expect(vault.staged).toHaveLength(1);
    expect(vault.staged[0]).toMatchObject({ path: "", targetPath: "Ideen.md", content: "- eins" });
  });

  // Some models escape the content one time too many, and the note lands with
  // the two characters \ and n where its line breaks belong.
  it("decodes literal line breaks in the proposed content", async () => {
    await executeFileTool("write_file", {
      path: "Gedicht.md",
      content: "Zeile eins\\nZeile zwei\\n\\nAbsatz zwei"
    });

    expect(vault.staged[0].content).toBe("Zeile eins\nZeile zwei\n\nAbsatz zwei");
  });

  // Rule F4: a second call updates the entry instead of adding a second one.
  it("updates an existing proposal instead of adding a second one", async () => {
    await executeFileTool("write_file", { path: "Ideen.md", content: "eins" });
    const second = await executeFileTool("write_file", { path: "Ideen.md", content: "zwei" });

    expect(vault.staged).toHaveLength(1);
    expect(vault.staged[0].content).toBe("zwei");
    expect(second?.content).toContain("replaced your earlier proposal");
  });

  it("builds a second edit on the first one's result", async () => {
    addFile("Liste.md", "eins\nzwei\ndrei");

    await executeFileTool("edit_file", { path: "Liste.md", old_text: "eins", new_text: "EINS" });
    await executeFileTool("edit_file", { path: "Liste.md", old_text: "drei", new_text: "DREI" });

    expect(vault.staged).toHaveLength(1);
    expect(vault.staged[0].content).toBe("EINS\nzwei\nDREI");
    expect(vault.staged[0].baseContent).toBe("eins\nzwei\ndrei");
  });

  it("reports a missing passage as retryable, without staging anything", async () => {
    const result = await executeFileTool("edit_file", {
      path: "Notiz.md",
      old_text: "Walross",
      new_text: "x"
    });

    expect(result?.retryable).toBe(true);
    expect(vault.staged).toHaveLength(0);
  });
});

describe("multi_edit", () => {
  beforeEach(() => {
    addFile("A.md", "alpha");
    addFile("B.md", "beta");
  });

  // A blanket "failed" makes a model repeat the edits that worked, and each
  // repetition is another proposal on a file that already has one.
  it("reports success and failure per edit", async () => {
    const result = await executeFileTool("multi_edit", {
      edits: [
        { path: "A.md", old_text: "alpha", new_text: "ALPHA" },
        { path: "B.md", old_text: "gamma", new_text: "GAMMA" }
      ]
    });

    expect(result?.content).toContain("1 of 2");
    expect(result?.content).toContain("B.md");
    expect(result?.retryable).toBe(true);
    expect(vault.staged).toHaveLength(1);
    expect(vault.staged[0].content).toBe("ALPHA");
  });

  it("confirms plainly when every edit worked", async () => {
    const result = await executeFileTool("multi_edit", {
      edits: [
        { path: "A.md", old_text: "alpha", new_text: "ALPHA" },
        { path: "B.md", old_text: "beta", new_text: "BETA" }
      ]
    });

    expect(result?.content.startsWith("OK:")).toBe(true);
    expect(vault.staged).toHaveLength(2);
  });
});

describe("delete_file and rename_file", () => {
  beforeEach(() => {
    addFile("Alt.md", "inhalt");
  });

  it("stages a deletion with the content that was there", async () => {
    await executeFileTool("delete_file", { path: "Alt.md" });

    expect(vault.staged[0]).toMatchObject({ path: "Alt.md", targetPath: "", content: null });
    expect(vault.staged[0].baseContent).toBe("inhalt");
    expect(vault.files.has("/vault/Alt.md")).toBe(true);
  });

  it("stages a rename without touching the content", async () => {
    await executeFileTool("rename_file", { path: "Alt.md", new_path: "Archiv/Neu.md" });

    expect(vault.staged[0]).toMatchObject({
      path: "Alt.md",
      targetPath: "Archiv/Neu.md",
      baseContent: "inhalt",
      content: "inhalt"
    });
  });

  it("refuses a rename onto an existing file", async () => {
    addFile("Belegt.md", "x");

    const result = await executeFileTool("rename_file", { path: "Alt.md", new_path: "Belegt.md" });

    expect(result?.content).toContain("already exists");
    expect(vault.staged).toHaveLength(0);
  });
});

describe("list_files and read_file", () => {
  it("marks the files that already carry a proposal", async () => {
    addFile("A.md", "a");
    addFile("B.md", "b");
    await executeFileTool("write_file", { path: "A.md", content: "neu" });

    const result = await executeFileTool("list_files", {});

    expect(result?.content).toContain("A.md  [change already proposed]");
    expect(result?.content).toMatch(/^B\.md$/m);
  });

  // Reading back the proposed version is what makes a follow-up edit_file work:
  // the model quotes what it just read, and that has to be what edit_file
  // searches in.
  it("hands back the proposed version and says so", async () => {
    addFile("A.md", "alt");
    await executeFileTool("write_file", { path: "A.md", content: "neu" });

    const result = await executeFileTool("read_file", { path: "A.md" });

    expect(result?.content).toContain("neu");
    expect(result?.content).toContain("YOUR proposed version");
  });

  it("answers with a retryable error for a path that does not exist", async () => {
    const result = await executeFileTool("read_file", { path: "Nichts.md" });

    expect(result?.retryable).toBe(true);
    expect(result?.content).toContain("list_files");
  });
});

it("answers null for a tool that is not a file tool", async () => {
  expect(await executeFileTool("get_document", {})).toBeNull();
});

// The second line of defence behind agentFileAccess / agentAllowDelete. Not
// offering a tool to the model is the first one, and it stopped being the whole
// story once a hallucinated name can be resolved to a real tool (see
// canonicalToolName in aiClient.ts).
describe("consent switches", () => {
  it("refuses every file tool while file access is off", async () => {
    setAgentCapabilities({ fileAccess: false, allowDelete: true });
    addFile("A.md", "Text");

    const result = await executeFileTool("write_file", { path: "B.md", content: "Neu" });

    expect(result?.content).toContain("switched off");
    expect(vault.staged).toHaveLength(0);
  });

  it("names the setting instead of reporting a malfunction", async () => {
    setAgentCapabilities({ fileAccess: false, allowDelete: true });

    const result = await executeFileTool("list_files", {});

    expect(result?.content).toContain("AI settings");
  });

  it("refuses deletion while only that sub-switch is off", async () => {
    setAgentCapabilities({ fileAccess: true, allowDelete: false });
    addFile("A.md", "Text");

    const deletion = await executeFileTool("delete_file", { path: "A.md" });
    const write = await executeFileTool("write_file", { path: "B.md", content: "Neu" });

    expect(deletion?.content).toContain("switched off");
    expect(write?.content.startsWith("OK:")).toBe(true);
  });

  it("still passes a name that is not a file tool through to the editor tools", async () => {
    setAgentCapabilities({ fileAccess: false, allowDelete: false });

    expect(await executeFileTool("get_document", {})).toBeNull();
  });
});
