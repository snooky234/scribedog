import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorToolBridge } from "./agentTools";
import type { StagedChange } from "./vaultStaging";

// The same fake vault as vaultFileTools.test.ts, plus the reminder index: the
// reminder tools reach the vault only through these stores and
// readMarkdownFile, and the open note only through the bridge.
const vault = vi.hoisted(() => ({
  files: new Map<string, string>(),
  staged: [] as StagedChange[],
  selectedFilePath: null as string | null,
  index: {} as Record<string, { due: string; note: string | null; text: string; checked: boolean | null; ordinal: number }[]>
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/")
}));

vi.mock("@/lib/fileSystem", () => ({
  getRelativeDisplayPath: (root: string, filePath: string) =>
    filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath,
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
      selectedFilePath: vault.selectedFilePath
    })
  }
}));

vi.mock("@/store/useStagedChangesStore", () => ({
  useStagedChangesStore: {
    getState: () => ({
      changes: vault.staged,
      changeFor: (relativePath: string) =>
        vault.staged.find((change) => (change.targetPath || change.path).toLowerCase() === relativePath.toLowerCase()),
      stage: (change: StagedChange) => {
        const existing = vault.staged.findIndex(
          (entry) => (entry.targetPath || entry.path).toLowerCase() === (change.targetPath || change.path).toLowerCase()
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

vi.mock("@/store/useRemindersStore", () => ({
  useRemindersStore: { getState: () => ({ folderPath: "/vault", byFile: vault.index }) }
}));

const { setAgentCapabilities } = await import("./vaultFileTools");
const { executeReminderTool } = await import("./reminderTools");

// Thursday, 2026-10-29 12:00 local time.
const NOW = new Date(2026, 9, 29, 12, 0);

const setBlockReminder = vi.fn<EditorToolBridge["setBlockReminder"]>(() => ({
  kind: "set",
  blockText: "Shorten this paragraph.",
  previous: null
}));

function bridge(document = "Shorten this paragraph.", hasDocument = true): EditorToolBridge {
  return {
    hasDocument: () => hasDocument,
    getDocument: () => document,
    getSelection: () => "",
    listImageSources: () => [],
    listPendingProposals: () => [],
    acceptPendingProposals: () => 0,
    discardPendingProposals: () => 0,
    proposeSelectionReplacement: () => "proposed",
    proposeInsertion: () => "proposed",
    proposePassageReplacement: () => "proposed",
    setImageWidth: () => null,
    setBlockReminder
  };
}

function run(name: string, args: Record<string, unknown>, editor: EditorToolBridge | null = bridge()) {
  return executeReminderTool(name, args, editor, NOW);
}

beforeEach(() => {
  vault.files.clear();
  vault.staged = [];
  vault.selectedFilePath = "/vault/Open.md";
  vault.index = {};
  vault.files.set("/vault/Open.md", "Shorten this paragraph.\n");
  vault.files.set("/vault/Projekte/Kunde A.md", "# Kunde A\n\n- [ ] Angebot schicken\n- [ ] Termin klären\n");
  setBlockReminder.mockClear();
  setAgentCapabilities({ fileAccess: true, allowDelete: true, reminders: true });
});

describe("set_reminder on the open note", () => {
  it("goes through the editor, with the due time and note normalized", async () => {
    const result = await run("set_reminder", { text: "Shorten", due: "2026-10-30T9:00", note: ' "first" ' });

    expect(setBlockReminder).toHaveBeenCalledWith("Shorten", { due: "2026-10-30 09:00", note: "first" });
    expect(result.content).toMatch(/^OK: reminder set for Friday 2026-10-30 09:00/);
    expect(vault.staged).toEqual([]);
  });

  it("takes the open note's own path the same way", async () => {
    await run("set_reminder", { text: "Shorten", due: "2026-10-30 09:00", path: "Open.md" });

    expect(setBlockReminder).toHaveBeenCalled();
    expect(vault.staged).toEqual([]);
  });

  it("answers a malformed due time with the format and today's date", async () => {
    const result = await run("set_reminder", { text: "Shorten", due: "Friday" });

    expect(result.retryable).toBe(true);
    expect(result.content).toContain('"YYYY-MM-DD HH:MM"');
    expect(result.content).toContain("Thursday 2026-10-29 12:00");
    expect(setBlockReminder).not.toHaveBeenCalled();
  });

  it("says when the time is already past", async () => {
    const result = await run("set_reminder", { text: "Shorten", due: "2026-10-28 09:00" });

    expect(result.content).toContain("already in the past");
  });

  it("reports an ambiguous text so the model can quote more", async () => {
    setBlockReminder.mockReturnValueOnce({ kind: "ambiguous", count: 3 });
    const result = await run("set_reminder", { text: "the", due: "2026-10-30 09:00" });

    expect(result).toMatchObject({ retryable: true });
    expect(result.content).toContain("matches 3 different blocks");
  });

  it("needs an open note when no path is given", async () => {
    const result = await run("set_reminder", { text: "Shorten", due: "2026-10-30 09:00" }, bridge("", false));

    expect(result.content).toMatch(/^Error: no note is open/);
  });
});

describe("set_reminder on another note", () => {
  it("stages the note with only the marker added", async () => {
    const result = await run("set_reminder", {
      text: "Angebot schicken",
      due: "2026-11-02 10:00",
      path: "Projekte/Kunde A.md"
    });

    expect(result.content).toMatch(/^OK: proposed a reminder for Monday 2026-11-02 10:00/);
    expect(setBlockReminder).not.toHaveBeenCalled();
    expect(vault.staged).toHaveLength(1);
    expect(vault.staged[0]).toMatchObject({
      targetPath: "Projekte/Kunde A.md",
      baseContent: "# Kunde A\n\n- [ ] Angebot schicken\n- [ ] Termin klären\n",
      content: "# Kunde A\n\n- [ ] Angebot schicken <!-- reminder: 2026-11-02 10:00 -->\n- [ ] Termin klären\n"
    });
  });

  it("builds a second change on the first one's staged text", async () => {
    await run("set_reminder", { text: "Angebot", due: "2026-11-02 10:00", path: "Projekte/Kunde A.md" });
    await run("set_reminder", { text: "Termin", due: "2026-11-03 10:00", path: "Projekte/Kunde A.md" });

    expect(vault.staged).toHaveLength(1);
    expect(vault.staged[0].content).toContain("Angebot schicken <!-- reminder: 2026-11-02 10:00 -->");
    expect(vault.staged[0].content).toContain("Termin klären <!-- reminder: 2026-11-03 10:00 -->");
  });

  it("is refused without file access", async () => {
    setAgentCapabilities({ fileAccess: false, allowDelete: true, reminders: true });
    const result = await run("set_reminder", { text: "Angebot", due: "2026-11-02 10:00", path: "Projekte/Kunde A.md" });

    expect(result.content).toMatch(/^Error: working on notes other than the open one is switched off/);
    expect(vault.staged).toEqual([]);
  });

  it("refuses a path outside the vault", async () => {
    const result = await run("set_reminder", { text: "x", due: "2026-11-02 10:00", path: "../secret.md" });

    expect(result.retryable).toBe(true);
    expect(vault.staged).toEqual([]);
  });
});

describe("the reminders switch", () => {
  it("is enforced where the tools run", async () => {
    setAgentCapabilities({ fileAccess: true, allowDelete: true, reminders: false });

    for (const name of ["set_reminder", "remove_reminder", "list_reminders"]) {
      const result = await run(name, { text: "Shorten", due: "2026-10-30 09:00" });

      expect(result.content).toMatch(/^Error: reminders are switched off/);
    }

    expect(setBlockReminder).not.toHaveBeenCalled();
  });
});

describe("list_reminders", () => {
  beforeEach(() => {
    vault.index = {
      // The open note's entry in the index is stale; the editor's text wins.
      "/vault/Open.md": [{ due: "2026-01-01 09:00", note: null, text: "stale", checked: null, ordinal: 0 }],
      "/vault/Projekte/Kunde A.md": [
        { due: "2026-11-02 10:00", note: "Budget", text: "Angebot schicken", checked: false, ordinal: 0 },
        { due: "2026-10-01 10:00", note: null, text: "Termin klären", checked: true, ordinal: 1 }
      ]
    };
  });

  it("lists the open note from the editor and every other note from the index, earliest first", async () => {
    const result = await run(
      "list_reminders",
      {},
      bridge("Shorten this paragraph. <!-- reminder: 2026-10-29 09:00 -->\n")
    );

    expect(result.content.split("\n")).toEqual([
      "3 reminder(s), earliest first. Now is Thursday 2026-10-29 12:00.",
      '- Thursday 2026-10-01 10:00 (checked off) | Projekte/Kunde A.md | "Termin klären"',
      '- Thursday 2026-10-29 09:00 (due, not dealt with yet) | Open.md | "Shorten this paragraph."',
      '- Monday 2026-11-02 10:00 | Projekte/Kunde A.md | "Angebot schicken" | note: "Budget"'
    ]);
  });

  it("lists only the open note without file access, and says so", async () => {
    setAgentCapabilities({ fileAccess: false, allowDelete: true, reminders: true });
    const result = await run("list_reminders", {}, bridge("Shorten this paragraph. <!-- reminder: 2026-10-29 09:00 -->\n"));

    expect(result.content).toContain("1 reminder(s)");
    expect(result.content).not.toContain("Kunde A");
    expect(result.content).toContain("Only the open note is listed");
  });

  it("narrows to one note", async () => {
    const result = await run("list_reminders", { path: "projekte/kunde a.md" });

    expect(result.content).toContain("2 reminder(s)");
    expect(result.content).not.toContain("Open.md");
  });
});
