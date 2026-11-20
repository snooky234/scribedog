import { describe, expect, it } from "vitest";
import { APP_TITLE, buildDocumentTitle, parseTitleFormat, UNSAVED_MARKER } from "./documentTitle";

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

describe("buildDocumentTitle with a title format", () => {
  const note = { ...base, notePath: "/vault/Q4 Plan.md", vaultName: "Team" };

  it("keeps the built-in format for an empty one", () => {
    expect(buildDocumentTitle({ ...note, titleFormat: null })).toBe("Q4 Plan - ScribeDog");
    expect(buildDocumentTitle({ ...note, titleFormat: "  " })).toBe("Q4 Plan - ScribeDog");
  });

  it("shows only the note", () => {
    expect(buildDocumentTitle({ ...note, titleFormat: "{doc}" })).toBe("Q4 Plan");
    expect(buildDocumentTitle({ ...base, vaultName: "Team", titleFormat: "{doc}" })).toBe("Team");
    expect(buildDocumentTitle({ ...base, titleFormat: "{doc}" })).toBe(APP_TITLE);
  });

  it("shows only a fixed name", () => {
    expect(buildDocumentTitle({ ...note, titleFormat: "ScribeDog" })).toBe("ScribeDog");
    expect(buildDocumentTitle({ ...base, titleFormat: "Team-Notizen" })).toBe("Team-Notizen");
  });

  it("drops the dangling separator when nothing is open", () => {
    expect(buildDocumentTitle({ ...note, titleFormat: "{doc} | Team-Notizen" })).toBe("Q4 Plan | Team-Notizen");
    expect(buildDocumentTitle({ ...base, titleFormat: "{doc} | Team-Notizen" })).toBe("Team-Notizen");
    expect(buildDocumentTitle({ ...base, titleFormat: "Team: {doc}" })).toBe("Team");
  });

  it("keeps the unsaved marker in front and note names literal", () => {
    expect(buildDocumentTitle({ ...note, showUnsaved: true, titleFormat: "Team: {doc}" })).toBe(`${UNSAVED_MARKER}Team: Q4 Plan`);
    expect(buildDocumentTitle({ ...base, notePath: "/vault/$&.md", titleFormat: "{doc}!" })).toBe("$&!");
  });
});

describe("parseTitleFormat", () => {
  it("treats empty and the unsubstituted placeholder as unset", () => {
    expect(parseTitleFormat(null)).toBeNull();
    expect(parseTitleFormat("")).toBeNull();
    expect(parseTitleFormat("__SCRIBEDOG_TITLE_FORMAT__")).toBeNull();
    expect(parseTitleFormat(" {doc} ")).toBe("{doc}");
  });
});
