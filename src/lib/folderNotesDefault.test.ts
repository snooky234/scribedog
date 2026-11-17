import { describe, expect, it } from "vitest";

import {
  FOLDER_NOTES_DEFAULT_STORAGE_KEY,
  resolveFolderNotesDefault,
  type FolderNotesDefaultStorage
} from "./folderNotesDefault";

function memoryStorage(initial: Record<string, string> = {}): FolderNotesDefaultStorage & {
  entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));

  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    key: (index) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    }
  };
}

describe("resolveFolderNotesDefault", () => {
  it("turns folder notes on for a fresh installation and keeps that answer", () => {
    const storage = memoryStorage({ "scribedog-language": "de", "scribedog-theme": "dark" });

    expect(resolveFolderNotesDefault(storage)).toBe(true);
    expect(storage.entries.get(FOLDER_NOTES_DEFAULT_STORAGE_KEY)).toBe("on");

    // The first opened vault writes the usage keys; the decision stays.
    storage.setItem("scribedog:lastFolderPath", "C:\\Notes");
    expect(resolveFolderNotesDefault(storage)).toBe(true);
  });

  it.each([
    ["scribedog:lastFolderPath", "C:\\Notes"],
    ["scribedog:recentFolderPaths", "[\"C:\\\\Notes\"]"],
    ["scribedog-last-file:/vault", "Inbox.md"]
  ])("keeps folder notes off for an installation that already used %s", (key, value) => {
    const storage = memoryStorage({ [key]: value });

    expect(resolveFolderNotesDefault(storage)).toBe(false);
    expect(storage.entries.get(FOLDER_NOTES_DEFAULT_STORAGE_KEY)).toBe("off");
  });

  it("returns a stored decision unchanged", () => {
    expect(resolveFolderNotesDefault(memoryStorage({ [FOLDER_NOTES_DEFAULT_STORAGE_KEY]: "off" }))).toBe(false);
    expect(
      resolveFolderNotesDefault(
        memoryStorage({ [FOLDER_NOTES_DEFAULT_STORAGE_KEY]: "on", "scribedog:lastFolderPath": "C:\\Notes" })
      )
    ).toBe(true);
  });

  it("falls back to off without usable storage", () => {
    expect(resolveFolderNotesDefault(null)).toBe(false);

    const throwing = memoryStorage();
    throwing.getItem = () => {
      throw new Error("denied");
    };
    expect(resolveFolderNotesDefault(throwing)).toBe(false);
  });
});
