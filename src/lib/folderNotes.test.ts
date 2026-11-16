import { describe, expect, it } from "vitest";

import {
  countFolderNotes,
  FOLDER_NOTE_FILE_NAME,
  getConversionFolderPath,
  getFolderNoteFolderPath,
  getFolderNotePath,
  getNoteDisplayName,
  isFolderNotePath
} from "@/lib/folderNotes";

describe("isFolderNotePath", () => {
  it("recognises the reserved file name in relative and absolute paths", () => {
    expect(isFolderNotePath("Rezepte/.scribedog-foldernote.md")).toBe(true);
    expect(isFolderNotePath("C:\\vault\\Rezepte\\.scribedog-foldernote.md")).toBe(true);
    expect(isFolderNotePath(".scribedog-foldernote.md")).toBe(true);
  });

  it("is case-insensitive, like the Windows filesystem", () => {
    expect(isFolderNotePath("Rezepte/.ScribeDog-FolderNote.MD")).toBe(true);
  });

  it("does not match ordinary notes or names that merely contain the marker", () => {
    expect(isFolderNotePath("Rezepte/Kuchen.md")).toBe(false);
    expect(isFolderNotePath("Rezepte/foo.scribedog-foldernote.md")).toBe(false);
    expect(isFolderNotePath("Rezepte/.scribedog-foldernote.md.bak")).toBe(false);
  });
});

describe("getFolderNoteFolderPath / getFolderNotePath", () => {
  it("round-trips a relative path", () => {
    expect(getFolderNoteFolderPath("A/B/.scribedog-foldernote.md")).toBe("A/B");
    expect(getFolderNotePath("A/B")).toBe(`A/B/${FOLDER_NOTE_FILE_NAME}`);
  });

  it("keeps the separator of the input on Windows-style absolute paths", () => {
    expect(getFolderNoteFolderPath("C:\\vault\\A\\.scribedog-foldernote.md")).toBe("C:\\vault\\A");
    expect(getFolderNotePath("C:\\vault\\A")).toBe(`C:\\vault\\A\\${FOLDER_NOTE_FILE_NAME}`);
    expect(getFolderNotePath("C:\\vault\\A\\")).toBe(`C:\\vault\\A\\${FOLDER_NOTE_FILE_NAME}`);
  });

  it("yields the empty relative path for a note in the vault root", () => {
    expect(getFolderNoteFolderPath(".scribedog-foldernote.md")).toBe("");
  });
});

describe("getNoteDisplayName", () => {
  it("strips .md from ordinary notes", () => {
    expect(getNoteDisplayName("Rezepte/Kuchen.md")).toBe("Kuchen");
    expect(getNoteDisplayName("C:\\vault\\Kuchen.MD")).toBe("Kuchen");
  });

  it("names a folder note after its folder", () => {
    expect(getNoteDisplayName("Rezepte/.scribedog-foldernote.md")).toBe("Rezepte");
    expect(getNoteDisplayName("C:\\vault\\Rezepte\\.scribedog-foldernote.md")).toBe("Rezepte");
  });

  it("falls back to the file name for a root-level folder note", () => {
    expect(getNoteDisplayName(".scribedog-foldernote.md")).toBe(FOLDER_NOTE_FILE_NAME);
  });
});

describe("countFolderNotes", () => {
  it("counts only folder notes", () => {
    expect(
      countFolderNotes(["/v/a.md", "/v/A/.scribedog-foldernote.md", "/v/B/.scribedog-foldernote.md"])
    ).toBe(2);
    expect(countFolderNotes([])).toBe(0);
  });
});

describe("getConversionFolderPath", () => {
  it("names the new folder after the note, next to it", () => {
    expect(getConversionFolderPath("/v/Rezepte.md")).toBe("/v/Rezepte");
    expect(getConversionFolderPath("C:\vault\Küche\Rezepte.MD")).toBe("C:\vault\Küche\Rezepte");
  });

  it("refuses folder notes, non-markdown paths and names that are only an extension", () => {
    expect(getConversionFolderPath(`/v/Rezepte/${FOLDER_NOTE_FILE_NAME}`)).toBeNull();
    expect(getConversionFolderPath("/v/bild.png")).toBeNull();
    expect(getConversionFolderPath("/v/.md")).toBeNull();
  });
});
