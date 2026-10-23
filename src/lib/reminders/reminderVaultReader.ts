import { backgroundRemoteVaultStorage, isRemoteVaultPath } from "@/lib/remoteVaults";
import { platform } from "@/platform";
import type { MarkdownFileRecord } from "@/platform/types";

/**
 * How the reminder list reads a vault that is not open. `known` is what the
 * last scan saw (path to mtime); a reader may use it to skip what has not
 * changed, and `readTextFile` is only asked for the notes whose mtime did.
 */
export type ReminderVaultReader = {
  listMarkdownFiles(root: string, known: Record<string, number>): Promise<MarkdownFileRecord[]>;
  readTextFile(path: string): Promise<string>;
};

// A local folder is read by the shell's own command, never by widening the
// fs scope (src-tauri/src/reminders.rs): the listing hands over the text of
// the changed notes that carry a marker, and every other note reads as empty.
function localReader(read: NonNullable<typeof platform.vault.readReminderNotes>): ReminderVaultReader {
  const contents = new Map<string, string>();

  return {
    async listMarkdownFiles(root, known) {
      const notes = await read(root, known);
      contents.clear();

      return notes.map(({ content, ...record }) => {
        if (content !== null) {
          contents.set(record.filePath, content);
        }

        return record;
      });
    },
    readTextFile: async (path) => contents.get(path) ?? ""
  };
}

/**
 * The reader for a vault of the vault menu other than the open one, null
 * where it cannot be read without the user. None of them is handed to
 * anything but the reminder list: the agent's tools work on the open vault
 * only.
 */
export async function reminderVaultReader(root: string): Promise<ReminderVaultReader | null> {
  // The browser's shared vaults: the session is the page's own, so a refusal
  // means the whole page is signed out anyway.
  const sharedStorage = await platform.sharedVaults?.storageFor(root);

  if (sharedStorage) {
    return sharedStorage;
  }

  if (isRemoteVaultPath(root)) {
    return backgroundRemoteVaultStorage(root);
  }

  if (platform.vault.readReminderNotes) {
    return localReader(platform.vault.readReminderNotes);
  }

  // The browser's own vault, while one of its shared vaults is open.
  return platform.features.localFolders ? null : platform.vaultStorage;
}
