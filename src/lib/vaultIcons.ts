/**
 * Icons for files and folders: an emoji per entry, stored in the vault's
 * `.scribedog/` directory rather than in the documents themselves.
 *
 * That placement is the design. An icon is how the tree looks to the person
 * who set it, not something the note says about itself — it has no business
 * in the markdown, in an export, or in a diff. Keeping it out also means
 * setting one is not an edit: no dirty state, no version, no save. And a
 * folder has no file to carry frontmatter at all, so a sidecar is the only
 * place where files and folders can work the same way.
 *
 * The price is that entries are keyed by vault-relative path: renaming or
 * moving inside ScribeDog carries the icon along (the store calls
 * `renameIconPath`), renaming in the OS does not — the watcher only sees one
 * path gone and another appeared. `order.json` makes the same trade.
 *
 * Pure data, no filesystem: vaultMeta.ts reads and writes the file, the store
 * owns the state, and the tests can exercise the path arithmetic on its own.
 */

/** Vault-relative path (slashes normalized) -> emoji. */
export type VaultIconMap = Record<string, string>;

/**
 * Longest emoji we accept. A ZWJ sequence with skin tones and a variation
 * selector ("👩🏽‍🚒") runs well past its visible single glyph, so this is a
 * guard against a pasted paragraph, not a character count.
 */
const MAX_ICON_LENGTH = 32;

/**
 * The key an entry is stored under. Lowercased like everywhere else in the
 * app that compares paths, because Windows hands the same file back in
 * different spellings; leading and trailing slashes are dropped so a folder
 * is keyed the same whether it arrived as "Ideas" or "Ideas/".
 */
export function iconPathKey(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

/**
 * Whether a value can be stored as an icon. Rejects anything with whitespace
 * or control characters: those come from a paste, never from the picker, and
 * a "空" icon that renders as a blank would look like a broken row.
 */
export function isValidIcon(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ICON_LENGTH &&
    // eslint-disable-next-line no-control-regex
    !/[\s\u0000-\u001f]/.test(value)
  );
}

/** Drops everything that is not a usable path/emoji pair, so a hand-edited or newer file cannot break the tree. */
export function normalizeVaultIcons(parsed: unknown): VaultIconMap {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const result: VaultIconMap = {};

  for (const [path, icon] of Object.entries(parsed as Record<string, unknown>)) {
    const key = iconPathKey(path);

    if (key && isValidIcon(icon)) {
      result[key] = icon;
    }
  }

  return result;
}

/**
 * Whether an icon is a glyph of an icon font (Private Use codepoints) rather
 * than an emoji. Such a glyph is drawn wider than the space its font reserves
 * for it, so the places that show it leave room beside it (see the --glyph
 * classes in file-tree.css and detail-panel.css).
 */
export function isGlyphIcon(icon: string): boolean {
  return /[\uE000-\uF8FF\u{F0000}-\u{10FFFD}]/u.test(icon);
}

export function getVaultIcon(icons: VaultIconMap, relativePath: string): string | null {
  return icons[iconPathKey(relativePath)] ?? null;
}

/** Sets or, with a null icon, clears one entry. Returns the same map when nothing changes, so callers can skip the write. */
export function setVaultIcon(
  icons: VaultIconMap,
  relativePath: string,
  icon: string | null
): VaultIconMap {
  const key = iconPathKey(relativePath);

  if (!key) {
    return icons;
  }

  if (icon === null) {
    if (!(key in icons)) {
      return icons;
    }

    const { [key]: _removed, ...rest } = icons;

    return rest;
  }

  if (!isValidIcon(icon) || icons[key] === icon) {
    return icons;
  }

  return { ...icons, [key]: icon };
}

/**
 * Moves an entry's icon to its new path, and with it every icon below it —
 * renaming a folder has to carry its children's icons, not just its own.
 * Used for renames and moves alike: both are the same arithmetic here.
 */
export function renameIconPath(
  icons: VaultIconMap,
  fromRelativePath: string,
  toRelativePath: string
): VaultIconMap {
  const fromKey = iconPathKey(fromRelativePath);
  const toKey = iconPathKey(toRelativePath);

  if (!fromKey || !toKey || fromKey === toKey) {
    return icons;
  }

  const result: VaultIconMap = {};
  let changed = false;

  for (const [key, icon] of Object.entries(icons)) {
    if (key === fromKey) {
      result[toKey] = icon;
      changed = true;
    } else if (key.startsWith(`${fromKey}/`)) {
      result[`${toKey}${key.slice(fromKey.length)}`] = icon;
      changed = true;
    } else {
      result[key] = icon;
    }
  }

  return changed ? result : icons;
}

/** Drops an entry's icon and those of everything below it. */
export function removeIconPath(icons: VaultIconMap, relativePath: string): VaultIconMap {
  const key = iconPathKey(relativePath);

  if (!key) {
    return icons;
  }

  const result: VaultIconMap = {};
  let changed = false;

  for (const [entryKey, icon] of Object.entries(icons)) {
    if (entryKey === key || entryKey.startsWith(`${key}/`)) {
      changed = true;
    } else {
      result[entryKey] = icon;
    }
  }

  return changed ? result : icons;
}

/**
 * Drops entries whose path no longer exists. Runs before a write, never on
 * read: a path can be briefly absent while the tree is still loading or a
 * remote vault is catching up, and losing an icon to that would be worse
 * than carrying a stale line in the file for a while.
 */
export function pruneVaultIcons(icons: VaultIconMap, existingRelativePaths: string[]): VaultIconMap {
  const existing = new Set(existingRelativePaths.map(iconPathKey));
  const result: VaultIconMap = {};
  let changed = false;

  for (const [key, icon] of Object.entries(icons)) {
    if (existing.has(key)) {
      result[key] = icon;
    } else {
      changed = true;
    }
  }

  return changed ? result : icons;
}
