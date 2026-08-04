import { afterEach, describe, expect, it } from "vitest";

import { pruneDocumentsToCurrentFolder } from "./documents";
import { setStagedOnlyPathProvider } from "./stagedPaths";

// The rule under test is what closes an open note again once it is gone from
// disk — right for a file deleted outside the app, and wrong for one the vault
// agent has only proposed, which has never been written in the first place.
// Getting that distinction wrong made a proposed note open, show its review for
// a few hundred milliseconds and then vanish on the next folder refresh.

const OPEN = "D:/Vault/Misc/Lavendel.md";

afterEach(() => setStagedOnlyPathProvider(null));

describe("pruneDocumentsToCurrentFolder", () => {
  it("drops a clean document whose file is gone from disk", () => {
    const documents = { [OPEN]: { content: "text", baseContent: "text" } };

    expect(pruneDocumentsToCurrentFolder(documents, [], OPEN)).toEqual({});
  });

  it("keeps a document with unsaved edits even when its file is gone", () => {
    const documents = { [OPEN]: { content: "neu", baseContent: "alt" } };

    expect(pruneDocumentsToCurrentFolder(documents, [], OPEN)).toEqual(documents);
  });

  it("keeps a note that is staged for creation, though it is on no disk", () => {
    setStagedOnlyPathProvider(() => [OPEN]);

    const documents = { [OPEN]: { content: "", baseContent: "" } };

    expect(pruneDocumentsToCurrentFolder(documents, [], OPEN)).toEqual(documents);
  });

  // Windows compares paths case-insensitively, and the staged layer stores the
  // path the model wrote.
  it("matches a staged path regardless of separators and case", () => {
    setStagedOnlyPathProvider(() => ["D:\\Vault\\misc\\lavendel.md"]);

    const documents = { [OPEN]: { content: "", baseContent: "" } };

    expect(pruneDocumentsToCurrentFolder(documents, [], OPEN)).toEqual(documents);
  });

  it("keeps a staged note that is not the selected one", () => {
    const other = "D:/Vault/Misc/Zweites.md";
    setStagedOnlyPathProvider(() => [other]);

    const documents = {
      [other]: { content: "", baseContent: "" },
      "D:/Vault/Weg.md": { content: "x", baseContent: "x" }
    };

    expect(pruneDocumentsToCurrentFolder(documents, [], null)).toEqual({
      [other]: { content: "", baseContent: "" }
    });
  });

  it("still keeps documents whose file is present", () => {
    const documents = { [OPEN]: { content: "text", baseContent: "text" } };

    expect(pruneDocumentsToCurrentFolder(documents, [OPEN], OPEN)).toEqual(documents);
  });

  // No provider registered is the normal case for every store that never loads
  // the staged layer; it must behave exactly as before.
  it("behaves as before when nothing registered a provider", () => {
    const documents = { [OPEN]: { content: "text", baseContent: "text" } };

    expect(pruneDocumentsToCurrentFolder(documents, [], OPEN)).toEqual({});
  });
});
