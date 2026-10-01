/**
 * Shared vaults: the data model and every rule about it, as pure functions.
 *
 * In a multi-instance setup (one container per person) each person can create
 * vaults that other people of the same setup open too. They live in a folder
 * mounted into every container, next to one registry file that says which
 * vaults exist, who created them and who may open them. Nothing here touches
 * the disk; registryStore.ts reads and writes the registry, service.ts moves
 * the folders.
 *
 * Who a request comes from is the instance it reached: one container per
 * person, one password per container, so the instance's configured user name
 * is the person.
 */

export type SharedRole = "editor";

/**
 * Stored as an object, not a bare name, so that a later read-only role only
 * changes `can()` and the dialogs, not the stored data.
 */
export type SharedMember = { user: string; role: SharedRole };

export type SharedVaultRecord = {
  id: string;
  /** Folder name below the shared root; fixed at creation, never renamed. */
  folder: string;
  /** Display name; the creator can change it at any time. */
  name: string;
  creator: string;
  /** Everyone who may open the vault, the creator included. */
  members: SharedMember[];
  createdAt: number;
  updatedAt: number;
  /** Set while the vault is in the trash. */
  deletedAt: number | null;
  deletedBy: string | null;
};

/** A one-time message for members, shown until each of them dismisses it. */
export type SharedNotice = {
  id: string;
  kind: "vault-deleted";
  vaultId: string;
  vaultName: string;
  by: string;
  at: number;
  recipients: string[];
};

export type SharedPerson = { registeredAt: number; lastSeenAt: number };

export type SharedRegistry = {
  version: 1;
  vaults: SharedVaultRecord[];
  /** Everyone whose instance has started at least once: the people one can pick as members. */
  people: Record<string, SharedPerson>;
  notices: SharedNotice[];
};

export type SharedAction = "read" | "write" | "manage" | "leave" | "restore";

export type SharedVaultErrorCode = "not_found" | "forbidden" | "invalid" | "gone";

const STATUS_BY_CODE: Record<SharedVaultErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  invalid: 400,
  gone: 410
};

export class SharedVaultError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: SharedVaultErrorCode,
    message: string
  ) {
    super(message);
    this.statusCode = STATUS_BY_CODE[code];
  }
}

/** How long a deleted vault stays restorable. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const MAX_NAME_LENGTH = 80;
export const MAX_MEMBERS = 50;

/**
 * The same rule the frontend applies (src/lib/userMeta.ts): a user name also
 * becomes a folder name, `.scribedog/users/<user>/`, so it is a plain slug.
 */
const USER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const VAULT_ID_PATTERN = /^[0-9a-f]{4,16}$/;
const FOLDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

export function isValidUserName(value: unknown): value is string {
  return typeof value === "string" && USER_NAME_PATTERN.test(value);
}

export function isValidVaultId(value: unknown): value is string {
  return typeof value === "string" && VAULT_ID_PATTERN.test(value);
}

export function emptyRegistry(): SharedRegistry {
  return { version: 1, vaults: [], people: {}, notices: [] };
}

const TRANSLITERATIONS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", æ: "ae", ø: "oe", å: "aa" };

/**
 * The folder-name part of a display name: "Familie & Freunde" -> "familie-freunde".
 * Made once, at creation; renaming the vault later never touches the folder,
 * so bookmarks and the desktop app's remote root stay valid.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[äöüßæøå]/g, (character) => TRANSLITERATIONS[character] ?? character)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

  return slug || "vault";
}

export function folderNameFor(name: string, id: string): string {
  return `${slugify(name)}-${id}`;
}

export function normalizeVaultName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new SharedVaultError("invalid", "Give the vault a name.");
  }

  const name = raw.trim().replace(/\s+/g, " ");

  if (!name) {
    throw new SharedVaultError("invalid", "Give the vault a name.");
  }

  if (name.length > MAX_NAME_LENGTH || CONTROL_CHARACTERS.test(name)) {
    throw new SharedVaultError("invalid", `The name must be at most ${MAX_NAME_LENGTH} characters of plain text.`);
  }

  return name;
}

/**
 * Members as asked for, checked against the people known to the setup. The
 * creator is always a member and is added when missing; asking for nobody
 * else is fine (a vault one can share later).
 */
export function normalizeMembers(registry: SharedRegistry, creator: string, raw: unknown): SharedMember[] {
  if (!Array.isArray(raw)) {
    throw new SharedVaultError("invalid", "Members must be a list of user names.");
  }

  const users = new Set<string>([creator]);

  for (const entry of raw) {
    const user = typeof entry === "string" ? entry : (entry as { user?: unknown } | null)?.user;

    if (!isValidUserName(user)) {
      throw new SharedVaultError("invalid", "Members must be a list of user names.");
    }

    if (!registry.people[user]) {
      throw new SharedVaultError("invalid", `"${user}" is not a person of this setup.`);
    }

    users.add(user);
  }

  if (users.size > MAX_MEMBERS) {
    throw new SharedVaultError("invalid", `A vault can have at most ${MAX_MEMBERS} members.`);
  }

  return [...users].map((user) => ({ user, role: "editor" as const }));
}

/**
 * Every permission question goes through here, for every route and the event
 * socket alike. A later read-only role changes this function and nothing
 * else on the server.
 */
export function can(user: string, vault: SharedVaultRecord, action: SharedAction): boolean {
  if (action === "restore") {
    return vault.deletedAt !== null && vault.creator === user;
  }

  if (vault.deletedAt !== null) {
    return false;
  }

  const member = vault.members.find((entry) => entry.user === user);

  if (!member) {
    return false;
  }

  switch (action) {
    case "read":
      return true;
    case "write":
      return member.role === "editor";
    case "manage":
      return vault.creator === user;
    case "leave":
      return vault.creator !== user;
  }
}

function findVault(registry: SharedRegistry, id: string): SharedVaultRecord {
  const vault = registry.vaults.find((entry) => entry.id === id);

  if (!vault) {
    throw new SharedVaultError("not_found", "There is no such shared vault.");
  }

  return vault;
}

/**
 * A vault the user may not see answers exactly like one that does not exist,
 * so the API never tells anyone which vaults the others have.
 */
export function requireAccess(
  registry: SharedRegistry,
  id: string,
  user: string,
  action: SharedAction
): SharedVaultRecord {
  const vault = findVault(registry, id);
  const isMember = vault.members.some((entry) => entry.user === user);

  if (!isMember) {
    throw new SharedVaultError("not_found", "There is no such shared vault.");
  }

  if (vault.deletedAt !== null && action !== "restore") {
    throw new SharedVaultError("gone", `"${vault.name}" was deleted.`);
  }

  if (!can(user, vault, action)) {
    throw new SharedVaultError(
      "forbidden",
      action === "leave" ? "The creator cannot leave a vault; delete it instead." : "Only the creator can do that."
    );
  }

  return vault;
}

function replaceVault(registry: SharedRegistry, next: SharedVaultRecord): SharedRegistry {
  return { ...registry, vaults: registry.vaults.map((entry) => (entry.id === next.id ? next : entry)) };
}

export function registerPerson(registry: SharedRegistry, user: string, now: number): SharedRegistry {
  const existing = registry.people[user];

  return {
    ...registry,
    people: { ...registry.people, [user]: { registeredAt: existing?.registeredAt ?? now, lastSeenAt: now } }
  };
}

/** Whether an id or folder name is free, the trash included. */
export function isIdAvailable(registry: SharedRegistry, id: string, folder: string): boolean {
  return !registry.vaults.some((entry) => entry.id === id || entry.folder === folder);
}

export function createVault(
  registry: SharedRegistry,
  input: { id: string; name: unknown; creator: string; members: unknown; now: number }
): { registry: SharedRegistry; vault: SharedVaultRecord } {
  const name = normalizeVaultName(input.name);
  const folder = folderNameFor(name, input.id);

  if (!isValidVaultId(input.id) || !FOLDER_PATTERN.test(folder) || !isIdAvailable(registry, input.id, folder)) {
    throw new SharedVaultError("invalid", "Could not pick a folder for this vault. Try again.");
  }

  const vault: SharedVaultRecord = {
    id: input.id,
    folder,
    name,
    creator: input.creator,
    members: normalizeMembers(registry, input.creator, input.members ?? []),
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    deletedBy: null
  };

  return { registry: { ...registry, vaults: [...registry.vaults, vault] }, vault };
}

export function updateVault(
  registry: SharedRegistry,
  id: string,
  user: string,
  changes: { name?: unknown; members?: unknown },
  now: number
): { registry: SharedRegistry; vault: SharedVaultRecord; removedUsers: string[] } {
  const current = requireAccess(registry, id, user, "manage");
  const name = changes.name === undefined ? current.name : normalizeVaultName(changes.name);
  const members = changes.members === undefined ? current.members : normalizeMembers(registry, current.creator, changes.members);
  const remaining = new Set(members.map((member) => member.user));
  const removedUsers = current.members.map((member) => member.user).filter((member) => !remaining.has(member));
  const vault = { ...current, name, members, updatedAt: now };

  return { registry: replaceVault(registry, vault), vault, removedUsers };
}

export function leaveVault(registry: SharedRegistry, id: string, user: string, now: number): SharedRegistry {
  const current = requireAccess(registry, id, user, "leave");

  return replaceVault(registry, {
    ...current,
    members: current.members.filter((member) => member.user !== user),
    updatedAt: now
  });
}

/** Moves the vault into the trash and leaves a one-time notice for everyone else in it. */
export function trashVault(
  registry: SharedRegistry,
  id: string,
  user: string,
  input: { now: number; noticeId: string }
): { registry: SharedRegistry; vault: SharedVaultRecord } {
  const current = requireAccess(registry, id, user, "manage");
  const vault = { ...current, deletedAt: input.now, deletedBy: user, updatedAt: input.now };
  const recipients = current.members.map((member) => member.user).filter((member) => member !== user);
  const notices = recipients.length
    ? [
        ...registry.notices,
        {
          id: input.noticeId,
          kind: "vault-deleted" as const,
          vaultId: id,
          vaultName: current.name,
          by: user,
          at: input.now,
          recipients
        }
      ]
    : registry.notices;

  return { registry: { ...replaceVault(registry, vault), notices }, vault };
}

/** Back out of the trash; the deletion notice goes too, it is no longer true. */
export function restoreVault(
  registry: SharedRegistry,
  id: string,
  user: string,
  now: number
): { registry: SharedRegistry; vault: SharedVaultRecord } {
  const current = requireAccess(registry, id, user, "restore");
  const vault = { ...current, deletedAt: null, deletedBy: null, updatedAt: now };

  return {
    registry: {
      ...replaceVault(registry, vault),
      notices: registry.notices.filter((notice) => notice.vaultId !== id)
    },
    vault
  };
}

export function purgeDueAt(vault: SharedVaultRecord): number | null {
  return vault.deletedAt === null ? null : vault.deletedAt + TRASH_RETENTION_MS;
}

/** Vaults whose time in the trash is up. */
export function vaultsDueForPurge(registry: SharedRegistry, now: number): SharedVaultRecord[] {
  return registry.vaults.filter((vault) => {
    const dueAt = purgeDueAt(vault);
    return dueAt !== null && dueAt <= now;
  });
}

/**
 * Drops purged vaults from the registry. Idempotent: an id that is already
 * gone (another container purged it first) is simply not there to drop.
 */
export function removeVaults(registry: SharedRegistry, ids: string[]): SharedRegistry {
  const dropped = new Set(ids);

  return { ...registry, vaults: registry.vaults.filter((vault) => !dropped.has(vault.id)) };
}

export function dismissNotice(registry: SharedRegistry, noticeId: string, user: string): SharedRegistry {
  return {
    ...registry,
    notices: registry.notices
      .map((notice) =>
        notice.id === noticeId ? { ...notice, recipients: notice.recipients.filter((recipient) => recipient !== user) } : notice
      )
      .filter((notice) => notice.recipients.length > 0)
  };
}

export type SharedVaultView = {
  id: string;
  name: string;
  creator: string;
  members: SharedMember[];
  isCreator: boolean;
  createdAt: number;
  updatedAt: number;
};

export type SharedTrashView = SharedVaultView & { deletedAt: number; purgeAt: number };

export type SharedOverview = {
  me: string;
  people: string[];
  vaults: SharedVaultView[];
  /** The user's own deleted vaults, restorable until purgeAt. */
  trash: SharedTrashView[];
  notices: Array<Omit<SharedNotice, "recipients">>;
};

function viewOf(vault: SharedVaultRecord, user: string): SharedVaultView {
  return {
    id: vault.id,
    name: vault.name,
    creator: vault.creator,
    members: vault.members,
    isCreator: vault.creator === user,
    createdAt: vault.createdAt,
    updatedAt: vault.updatedAt
  };
}

/** What one person gets to see: only vaults they are in, never the others'. */
export function overviewFor(registry: SharedRegistry, user: string): SharedOverview {
  const byName = (left: { name: string }, right: { name: string }) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });

  return {
    me: user,
    people: Object.keys(registry.people).sort(),
    vaults: registry.vaults
      .filter((vault) => can(user, vault, "read"))
      .map((vault) => viewOf(vault, user))
      .sort(byName),
    trash: registry.vaults
      .filter((vault) => can(user, vault, "restore"))
      .map((vault) => ({ ...viewOf(vault, user), deletedAt: vault.deletedAt!, purgeAt: purgeDueAt(vault)! }))
      .sort(byName),
    notices: registry.notices
      .filter((notice) => notice.recipients.includes(user))
      .map(({ recipients: _recipients, ...notice }) => notice)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The registry as read from disk, checked field by field. Entries that do
 * not hold up are dropped rather than trusted: the file is shared by every
 * container and could be edited by hand.
 */
export function normalizeRegistry(raw: unknown): SharedRegistry {
  if (!isRecord(raw)) {
    return emptyRegistry();
  }

  const vaults: SharedVaultRecord[] = [];

  for (const entry of Array.isArray(raw.vaults) ? raw.vaults : []) {
    if (!isRecord(entry)) {
      continue;
    }

    const members = (Array.isArray(entry.members) ? entry.members : [])
      .filter((member): member is { user: string } => isRecord(member) && isValidUserName(member.user))
      .map((member) => ({ user: member.user, role: "editor" as const }));

    if (
      !isValidVaultId(entry.id) ||
      typeof entry.folder !== "string" ||
      !FOLDER_PATTERN.test(entry.folder) ||
      typeof entry.name !== "string" ||
      !isValidUserName(entry.creator) ||
      typeof entry.createdAt !== "number"
    ) {
      continue;
    }

    vaults.push({
      id: entry.id,
      folder: entry.folder,
      name: entry.name,
      creator: entry.creator,
      members,
      createdAt: entry.createdAt,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : entry.createdAt,
      deletedAt: typeof entry.deletedAt === "number" ? entry.deletedAt : null,
      deletedBy: isValidUserName(entry.deletedBy) ? entry.deletedBy : null
    });
  }

  const people: Record<string, SharedPerson> = {};

  if (isRecord(raw.people)) {
    for (const [user, person] of Object.entries(raw.people)) {
      if (isValidUserName(user) && isRecord(person) && typeof person.registeredAt === "number") {
        people[user] = {
          registeredAt: person.registeredAt,
          lastSeenAt: typeof person.lastSeenAt === "number" ? person.lastSeenAt : person.registeredAt
        };
      }
    }
  }

  const notices: SharedNotice[] = [];

  for (const entry of Array.isArray(raw.notices) ? raw.notices : []) {
    if (
      isRecord(entry) &&
      typeof entry.id === "string" &&
      entry.kind === "vault-deleted" &&
      typeof entry.vaultId === "string" &&
      typeof entry.vaultName === "string" &&
      isValidUserName(entry.by) &&
      typeof entry.at === "number" &&
      Array.isArray(entry.recipients)
    ) {
      notices.push({
        id: entry.id,
        kind: "vault-deleted",
        vaultId: entry.vaultId,
        vaultName: entry.vaultName,
        by: entry.by,
        at: entry.at,
        recipients: entry.recipients.filter(isValidUserName)
      });
    }
  }

  return { version: 1, vaults, people, notices };
}
