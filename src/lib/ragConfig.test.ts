import { describe, expect, it } from "vitest";

import {
  buildRagFolderTree,
  collectFolderPaths,
  countIncludedFiles,
  folderCheckState,
  isFileIncluded,
  isFolderIncluded,
  pruneSelection,
  setFolderIncluded,
  type RagFolderSelection
} from "./ragConfig";

// The knowledge base's folder selection is stored as overrides plus
// inheritance, which buys two user-visible properties that a flat list of
// included folders would not have: a folder created later inside a ticked one
// is covered automatically, and unticking a parent clears everything under it.
// Both are what the settings tab's warning promises, so both are pinned here.

const ALL_IN: RagFolderSelection = { rootIncluded: true, overrides: {} };

describe("inheritance", () => {
  it("falls back to the root when nothing overrides", () => {
    expect(isFolderIncluded(ALL_IN, "Projekte/Kunde A")).toBe(true);
    expect(isFolderIncluded({ rootIncluded: false, overrides: {} }, "Projekte")).toBe(false);
  });

  it("lets the nearest ancestor win", () => {
    const selection: RagFolderSelection = {
      rootIncluded: true,
      overrides: { Archiv: false, "Archiv/2024": true }
    };

    expect(isFolderIncluded(selection, "Archiv")).toBe(false);
    expect(isFolderIncluded(selection, "Archiv/2019")).toBe(false);
    expect(isFolderIncluded(selection, "Archiv/2024")).toBe(true);
    expect(isFolderIncluded(selection, "Archiv/2024/Q1")).toBe(true);
  });

  it("covers a folder that did not exist when the parent was ticked", () => {
    // The warning in the settings tab says so out loud; this is the behaviour
    // it describes.
    const selection = setFolderIncluded(ALL_IN, "Projekte", true);

    expect(isFolderIncluded(selection, "Projekte/Neu/Noch tiefer")).toBe(true);
  });

  it("decides a file by the folder it sits in", () => {
    const selection: RagFolderSelection = { rootIncluded: true, overrides: { Privat: false } };

    expect(isFileIncluded(selection, "Notizen/idee.md")).toBe(true);
    expect(isFileIncluded(selection, "Privat/tagebuch.md")).toBe(false);
    expect(isFileIncluded(selection, "liste.md")).toBe(true);
  });
});

describe("setFolderIncluded", () => {
  it("drops an override that agrees with what it would inherit", () => {
    // Keeping it would be harmless for isFolderIncluded but would make
    // folderCheckState report "mixed" for the parent — see below.
    const selection = setFolderIncluded(ALL_IN, "Projekte", true);

    expect(selection.overrides).toEqual({});
  });

  it("clears every override below the folder being changed", () => {
    const selection: RagFolderSelection = {
      rootIncluded: true,
      overrides: { "Archiv/2024": true, "Archiv/2019": false, Privat: false }
    };

    const next = setFolderIncluded(selection, "Archiv", false);

    expect(next.overrides).toEqual({ Archiv: false, Privat: false });
  });

  it("moves the root's own state into rootIncluded and resets the rest", () => {
    const selection: RagFolderSelection = { rootIncluded: true, overrides: { Privat: false } };

    expect(setFolderIncluded(selection, "", false)).toEqual({ rootIncluded: false, overrides: {} });
  });

  it("re-including a child of an excluded parent keeps both overrides", () => {
    let selection = setFolderIncluded(ALL_IN, "Archiv", false);
    selection = setFolderIncluded(selection, "Archiv/2024", true);

    expect(selection.overrides).toEqual({ Archiv: false, "Archiv/2024": true });
  });
});

describe("folderCheckState", () => {
  it("reports mixed only where descendants disagree", () => {
    const selection: RagFolderSelection = {
      rootIncluded: true,
      overrides: { Archiv: false, "Archiv/2024": true }
    };

    expect(folderCheckState(selection, "")).toBe("mixed");
    expect(folderCheckState(selection, "Archiv")).toBe("mixed");
    expect(folderCheckState(selection, "Archiv/2024")).toBe("checked");
    expect(folderCheckState(selection, "Archiv/2019")).toBe("unchecked");
    expect(folderCheckState(selection, "Projekte")).toBe("checked");
  });

  it("is never mixed for a canonical selection with no overrides", () => {
    expect(folderCheckState(ALL_IN, "")).toBe("checked");
    expect(folderCheckState({ rootIncluded: false, overrides: {} }, "")).toBe("unchecked");
  });
});

describe("pruneSelection", () => {
  it("forgets folders that no longer exist", () => {
    const selection: RagFolderSelection = {
      rootIncluded: true,
      overrides: { Privat: false, Geloescht: false }
    };

    expect(pruneSelection(selection, ["Privat", "Notizen"]).overrides).toEqual({ Privat: false });
  });
});

describe("buildRagFolderTree", () => {
  const files = [
    { relativePath: "liste.md" },
    { relativePath: "Projekte/Kunde A/angebot.md" },
    { relativePath: "Projekte/Kunde A/notizen.md" },
    { relativePath: "Projekte/Kunde B/notizen.md" },
    { relativePath: "Privat/tagebuch.md" }
  ];

  it("nests folders and counts only their own files", () => {
    const tree = buildRagFolderTree(files);

    expect(tree.fileCount).toBe(1);
    expect(tree.children.map((child) => child.name)).toEqual(["Privat", "Projekte"]);

    const projekte = tree.children.find((child) => child.name === "Projekte");

    // An intermediate folder holding no file of its own still appears, because
    // its children need somewhere to hang.
    expect(projekte?.fileCount).toBe(0);
    expect(projekte?.children.map((child) => child.path)).toEqual([
      "Projekte/Kunde A",
      "Projekte/Kunde B"
    ]);
  });

  it("lists every folder path for pruning", () => {
    expect(collectFolderPaths(buildRagFolderTree(files)).sort()).toEqual([
      "Privat",
      "Projekte",
      "Projekte/Kunde A",
      "Projekte/Kunde B"
    ]);
  });

  it("counts the files an excluded folder takes out", () => {
    const selection = setFolderIncluded(ALL_IN, "Projekte/Kunde A", false);

    expect(countIncludedFiles(ALL_IN, files)).toBe(5);
    expect(countIncludedFiles(selection, files)).toBe(3);
  });
});
