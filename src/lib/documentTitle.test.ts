import { describe, expect, it } from "vitest";
import { APP_TITLE, buildDocumentTitle, UNSAVED_MARKER } from "./documentTitle";

const base = { folderPath: "/vault", notePath: null, vaultName: null, showUnsaved: false };

describe("buildDocumentTitle", () => {
  it("is the app name when nothing is open", () => {
    expect(buildDocumentTitle({ ...base, folderPath: null })).toBe(APP_TITLE);
  });

  it("is the app name for a vault without a name worth showing", () => {
    expect(buildDocumentTitle(base)).toBe(APP_TITLE);
    expect(buildDocumentTitle({ ...base, vaultName: "  " })).toBe(APP_TITLE);
  });

  it("names the vault when no note is open", () => {
    expect(buildDocumentTitle({ ...base, vaultName: "Team" })).toBe("Team - ScribeDog");
  });

  it("puts the note first, without its extension", () => {
    expect(buildDocumentTitle({ ...base, notePath: "/vault/Projekte/Q4 Plan.md", vaultName: "Team" })).toBe(
      "Q4 Plan - ScribeDog"
    );
  });

  it("names a folder note after its folder", () => {
    expect(buildDocumentTitle({ ...base, notePath: "/vault/Rezepte/.scribedog-foldernote.md" })).toBe(
      "Rezepte - ScribeDog"
    );
  });

  it("handles Windows paths", () => {
    expect(
      buildDocumentTitle({
        ...base,
        folderPath: "C:\\Notes",
        notePath: "C:\\Notes\\Rezepte\\.scribedog-foldernote.md"
      })
    ).toBe("Rezepte - ScribeDog");
  });

  it("does not name a folder note in the vault root after the technical root", () => {
    expect(buildDocumentTitle({ ...base, notePath: "/vault/.scribedog-foldernote.md", vaultName: "Team" })).toBe(
      "Team - ScribeDog"
    );
    expect(buildDocumentTitle({ ...base, notePath: "/vault/.scribedog-foldernote.md" })).toBe(APP_TITLE);
  });

  it("marks unsaved changes on the note only", () => {
    expect(buildDocumentTitle({ ...base, notePath: "/vault/a.md", showUnsaved: true })).toBe(
      `${UNSAVED_MARKER}a - ScribeDog`
    );
    expect(buildDocumentTitle({ ...base, vaultName: "Team", showUnsaved: true })).toBe("Team - ScribeDog");
  });
});
