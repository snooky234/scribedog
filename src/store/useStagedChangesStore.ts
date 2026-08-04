import { join } from "@tauri-apps/api/path";
import { create } from "zustand";

import {
  checkpointsToRevert,
  createCheckpoint,
  deleteCheckpoints,
  listCheckpoints,
  readCheckpointBlob,
  resolveRevertTargets,
  type Checkpoint,
  type CheckpointSource
} from "@/lib/chat/checkpoints";
import { readStagedChanges, writeStagedChanges } from "@/lib/chat/stagedChangesFile";
import {
  findStagedChange,
  normalizeVaultPath,
  removeStagedChange,
  resolveApplyOrder,
  stagedChangeKind,
  upsertStagedChange,
  vaultPathKey,
  type StagedChange
} from "@/lib/chat/vaultStaging";
import { getRelativeDisplayPath, readMarkdownFile } from "@/lib/fileSystem";
import { setStagedOnlyPathProvider } from "@/store/appStore/stagedPaths";
import { useAppStore } from "@/store/useAppStore";

/**
 * The vault agent's proposals, and the checkpoints that make an applied batch
 * undoable. Everything the agent proposes for a file other than the open one
 * lives here (see src/lib/chat/vaultStaging.ts for the data model and why it is
 * state-based rather than an op log).
 *
 * Two invariants this store is responsible for, and the reasons they matter:
 *
 *  - The apply path goes through the *app store's* actions, never through
 *    fileSystem.ts directly. replaceFileContent / createFileAtPath /
 *    renameFilePath / deleteFilePath pull versioning, manual sort order, image
 *    cleanup and the tree update along; a bare writeTextFile leaves all four
 *    behind.
 *  - Those actions read their state through get(), so they run strictly
 *    sequentially. Applying a batch in parallel would have them overwrite each
 *    other's state (see the note on AppSlice in src/store/appStore/types.ts).
 */

export type StagedApplyResult = {
  applied: number;
  failed: string[];
};

type StagedChangesState = {
  folderPath: string | null;
  changes: StagedChange[];
  checkpoints: Checkpoint[];
  // A batch is being written to disk. The bars and buttons disable on this so
  // a second click cannot start a competing run.
  isApplying: boolean;

  setFolder: (folderPath: string | null) => Promise<void>;
  /** Stages a proposal, merging it into the entry that already covers the file. */
  stage: (change: StagedChange) => void;
  /**
   * The marker for the open document: its real proposals are widgets in the
   * editor, this only makes the paw and "accept all" aware of them.
   */
  markEditorProposal: (relativePath: string, sessionId: string, messageIndex: number) => void;
  clearEditorProposal: () => void;
  changeFor: (relativePath: string) => StagedChange | undefined;
  /**
   * Makes a file the agent has only *proposed* openable, by seeding an empty
   * in-memory document for it. selectFilePath checks fileDocuments before it
   * touches the disk, so this is what lets the user click a greyed-out row in
   * the tree and see the proposal — without a file existing anywhere yet.
   */
  seedCreatedDocument: (absolutePath: string) => void;
  discardOne: (relativePath: string) => Promise<void>;
  discardAll: () => Promise<void>;
  applyOne: (relativePath: string) => Promise<StagedApplyResult>;
  applyAll: () => Promise<StagedApplyResult>;
  /** Undoes every batch back to (and including) this checkpoint. */
  revertTo: (checkpointId: string) => Promise<boolean>;
  refreshCheckpoints: () => Promise<void>;
};

/** Vault-relative ("a/b.md") to an absolute path the fs layer accepts. */
async function toAbsolutePath(folderPath: string, relativePath: string): Promise<string> {
  return join(folderPath, ...normalizeVaultPath(relativePath).split("/"));
}

/** Content of a vault file right now, or null when it does not exist. */
async function currentContent(folderPath: string, relativePath: string): Promise<string | null> {
  const appState = useAppStore.getState();
  const absolute = await toAbsolutePath(folderPath, relativePath);
  const known = appState.filePaths.find(
    (path) => vaultPathKey(getRelativeDisplayPath(folderPath, path)) === vaultPathKey(relativePath)
  );

  // An unsaved edit is the content that is really there as far as the user is
  // concerned, so it is what a checkpoint has to preserve.
  const document = known ? appState.fileDocuments[known] : undefined;

  if (document) {
    return document.content;
  }

  return readMarkdownFile(absolute).catch(() => null);
}

function persist(folderPath: string | null, changes: StagedChange[]): void {
  if (folderPath) {
    void writeStagedChanges(folderPath, changes).catch(() => undefined);
  }
}

/**
 * Absolute paths of the notes that exist only as a proposal. The app store's
 * folder refresh asks for these so it stops treating "not on disk" as "deleted
 * outside the app" for a file that has simply not been written yet — see
 * src/store/appStore/stagedPaths.ts for why it is a registration rather than an
 * import.
 *
 * Synchronous and computed on demand: it is read inside a refresh that already
 * holds the store's state, so a mirrored copy could only ever be one tick stale.
 */
function stagedOnlyPaths(): string[] {
  const { folderPath, changes } = useStagedChangesStore.getState();

  if (!folderPath) {
    return [];
  }

  const separator = folderPath.includes("\\") ? "\\" : "/";

  return changes
    .filter((change) => !change.path && change.targetPath)
    .map(
      (change) =>
        `${folderPath}${separator}${normalizeVaultPath(change.targetPath).split("/").join(separator)}`
    );
}

setStagedOnlyPathProvider(stagedOnlyPaths);

export const useStagedChangesStore = create<StagedChangesState>((set, get) => ({
  folderPath: null,
  changes: [],
  checkpoints: [],
  isApplying: false,

  setFolder: async (folderPath) => {
    if (folderPath === get().folderPath) {
      return;
    }

    if (!folderPath) {
      set({ folderPath: null, changes: [], checkpoints: [] });
      return;
    }

    const [changes, checkpoints] = await Promise.all([
      readStagedChanges(folderPath),
      listCheckpoints(folderPath)
    ]);

    set({ folderPath, changes, checkpoints });
  },

  stage: (change) => {
    const changes = upsertStagedChange(get().changes, change);

    set({ changes });
    persist(get().folderPath, changes);
  },

  markEditorProposal: (relativePath, sessionId, messageIndex) => {
    const path = normalizeVaultPath(relativePath);

    if (!path) {
      return;
    }

    // A file that already has an entry keeps it — either the marker is already
    // there, or a content-based entry is, which is the richer statement (and
    // the file tools refuse the open document anyway).
    if (findStagedChange(get().changes, path)) {
      return;
    }

    const changes = [
      ...get().changes,
      {
        path,
        targetPath: path,
        baseContent: null,
        content: null,
        sessionId,
        messageIndex,
        editorProposal: true as const
      }
    ];

    set({ changes });
  },

  clearEditorProposal: () => {
    const changes = get().changes.filter((change) => !change.editorProposal);

    if (changes.length !== get().changes.length) {
      set({ changes });
    }
  },

  changeFor: (relativePath) => findStagedChange(get().changes, relativePath),

  seedCreatedDocument: (absolutePath) => {
    const { folderPath } = get();
    const appState = useAppStore.getState();

    if (!folderPath || appState.fileDocuments[absolutePath]) {
      return;
    }

    const change = findStagedChange(
      get().changes,
      normalizeVaultPath(getRelativeDisplayPath(folderPath, absolutePath))
    );

    if (!change || change.path || change.baseContent !== null) {
      return;
    }

    // Empty rather than the proposed content: the editor shows the *before*
    // state and renders the proposal on top of it as one green block, exactly
    // as it does for an existing file (see buildStagedPreview).
    useAppStore.setState({
      fileDocuments: {
        ...appState.fileDocuments,
        [absolutePath]: { content: "", baseContent: "" }
      }
    });
  },

  discardOne: async (relativePath) => {
    const target = findStagedChange(get().changes, relativePath);

    if (!target) {
      return;
    }

    const changes = removeStagedChange(get().changes, relativePath);

    set({ changes });
    persist(get().folderPath, changes);
  },

  discardAll: async () => {
    set({ changes: [] });
    persist(get().folderPath, []);
  },

  applyOne: async (relativePath) => {
    const target = findStagedChange(get().changes, relativePath);

    return target ? applyBatch([target], set, get) : { applied: 0, failed: [] };
  },

  applyAll: async () => applyBatch(get().changes, set, get),

  revertTo: async (checkpointId) => {
    const { folderPath } = get();

    if (!folderPath || get().isApplying) {
      return false;
    }

    const checkpoints = await listCheckpoints(folderPath);
    const toUndo = checkpointsToRevert(checkpoints, checkpointId);

    if (toUndo.length === 0) {
      return false;
    }

    set({ isApplying: true });

    try {
      const appStore = useAppStore.getState();

      // Sequential for the same reason the apply run is: each action reads the
      // store state it is about to change through get().
      for (const entry of resolveRevertTargets(toUndo)) {
        const absolute = await toAbsolutePath(folderPath, entry.path);
        const existsInTree = useAppStore
          .getState()
          .filePaths.some((path) => vaultPathKey(path) === vaultPathKey(absolute));

        if (entry.blobId === null) {
          // The file did not exist before the batch, so undoing means removing
          // it again. Deleting through the store keeps the tree and the version
          // history in step.
          if (existsInTree) {
            await appStore.deleteFilePath(absolute);
          }

          continue;
        }

        const content = await readCheckpointBlob(folderPath, entry.blobId).catch(() => null);

        if (content === null) {
          continue;
        }

        // replaceFileContent / createFileAtPath rather than a raw write: the
        // restored state becomes a NEW version on top of the history instead of
        // erasing what happened in between. Revert moves the state back, the
        // version history keeps everything.
        if (existsInTree) {
          await appStore.replaceFileContent(absolute, content);
        } else {
          await appStore.createFileAtPath(absolute, content);
        }
      }

      await deleteCheckpoints(
        folderPath,
        toUndo.map((checkpoint) => checkpoint.id)
      );

      set({ checkpoints: await listCheckpoints(folderPath), isApplying: false });

      return true;
    } catch {
      set({ isApplying: false });

      return false;
    }
  },

  refreshCheckpoints: async () => {
    const { folderPath } = get();

    set({ checkpoints: folderPath ? await listCheckpoints(folderPath) : [] });
  }
}));

/**
 * Writes a batch of staged changes to disk, checkpointing first.
 *
 * The checkpoint is awaited *before* the first write and covers every path the
 * batch touches, on both sides of a rename. For a deletion the saved content is
 * the only route back, so this ordering is the whole guarantee: a checkpoint
 * started in parallel with the apply run would be racing the thing it exists to
 * protect against.
 */
async function applyBatch(
  batch: StagedChange[],
  set: (partial: Partial<StagedChangesState>) => void,
  get: () => StagedChangesState
): Promise<StagedApplyResult> {
  const { folderPath } = get();

  if (!folderPath || batch.length === 0 || get().isApplying) {
    return { applied: 0, failed: [] };
  }

  set({ isApplying: true });

  const failed: string[] = [];
  let applied = 0;

  try {
    const ops = resolveApplyOrder(batch);

    if (ops.length > 0) {
      const sources: CheckpointSource[] = [];
      const seen = new Set<string>();

      for (const change of batch) {
        for (const path of [change.path, change.targetPath]) {
          const key = vaultPathKey(path);

          if (!path || change.editorProposal || seen.has(key)) {
            continue;
          }

          seen.add(key);
          sources.push({ path: normalizeVaultPath(path), content: await currentContent(folderPath, path) });
        }
      }

      const withSession = batch.find((change) => change.sessionId);

      await createCheckpoint(folderPath, {
        sessionId: withSession?.sessionId ?? "",
        messageIndex: withSession?.messageIndex ?? -1,
        label: describeBatch(batch),
        sources
      });
    }

    for (const op of ops) {
      const appStore = useAppStore.getState();
      const absolute = await toAbsolutePath(folderPath, op.path);
      let ok = false;

      if (op.kind === "create") {
        ok = await appStore.createFileAtPath(absolute, op.content);
      } else if (op.kind === "write") {
        ok = await appStore.replaceFileContent(absolute, op.content);
      } else if (op.kind === "delete") {
        ok = await appStore.deleteFilePath(absolute);
      } else {
        ok = await moveStagedFile(folderPath, absolute, op.targetPath);
      }

      if (ok) {
        applied += 1;
      } else {
        failed.push(op.path);
      }
    }

    // Only what actually reached disk leaves the staging list. An entry whose
    // write failed stays put: dropping it would lose the proposal *and* leave
    // the user with no sign that anything went wrong.
    //
    // The editor's own proposals are settled by the editor, not from here — the
    // accept-all button delegates those to acceptPendingProposals.
    const failedKeys = new Set(failed.map(vaultPathKey));
    const settledKeys = new Set(
      batch
        .filter(
          (change) =>
            !failedKeys.has(vaultPathKey(change.path)) && !failedKeys.has(vaultPathKey(change.targetPath))
        )
        .map((change) => vaultPathKey(change.path || change.targetPath))
    );
    const remaining = get().changes.filter(
      (change) => !settledKeys.has(vaultPathKey(change.path || change.targetPath))
    );

    set({ changes: remaining, checkpoints: await listCheckpoints(folderPath) });
    persist(folderPath, remaining);

    return { applied, failed };
  } catch {
    return { applied, failed };
  } finally {
    set({ isApplying: false });
  }
}

/**
 * Renames and/or moves a file through the app store's own actions: the move
 * across folders is moveTreeEntry (it rewrites relative image paths and carries
 * the version history), the rename inside a folder is renameFilePath. Splitting
 * it this way is what keeps this from becoming a fifth implementation of "move
 * a note" that forgets one of the four subsystems.
 */
async function moveStagedFile(
  folderPath: string,
  sourceAbsolutePath: string,
  targetRelativePath: string
): Promise<boolean> {
  const target = normalizeVaultPath(targetRelativePath);
  const segments = target.split("/");
  const basename = segments[segments.length - 1].replace(/\.md$/i, "");
  const targetDirectory = await join(folderPath, ...segments.slice(0, -1));
  const sourceDirectory = await join(
    folderPath,
    ...normalizeVaultPath(getRelativeDisplayPath(folderPath, sourceAbsolutePath)).split("/").slice(0, -1)
  );

  let currentPath = sourceAbsolutePath;

  if (vaultPathKey(sourceDirectory) !== vaultPathKey(targetDirectory)) {
    // The destination folder may not exist yet — the agent can move a note into
    // a folder it named in the same batch.
    if (!(await useAppStore.getState().createFolderAtPath(targetDirectory))) {
      return false;
    }

    const moved = await useAppStore.getState().moveTreeEntry({
      kind: "file",
      sourcePath: currentPath,
      targetParentDirectory: targetDirectory,
      // Appended: a batch has no meaningful position to claim inside the
      // destination folder.
      targetIndex: Number.MAX_SAFE_INTEGER
    });

    if (!moved) {
      return false;
    }

    currentPath = await join(targetDirectory, currentPath.split(/[\\/]/).pop() ?? basename);
  }

  const currentBasename = (currentPath.split(/[\\/]/).pop() ?? "").replace(/\.md$/i, "");

  if (currentBasename.toLowerCase() === basename.toLowerCase()) {
    return true;
  }

  return useAppStore.getState().renameFilePath(currentPath, basename);
}

/** One line naming what a batch did, shown in the undo confirmation. */
function describeBatch(batch: StagedChange[]): string {
  const applicable = batch.filter((change) => !change.editorProposal);

  if (applicable.length === 1) {
    const change = applicable[0];

    return `${stagedChangeKind(change)}: ${change.targetPath || change.path}`;
  }

  return applicable
    .slice(0, 3)
    .map((change) => change.targetPath || change.path)
    .join(", ");
}
