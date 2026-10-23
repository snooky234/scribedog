/** One server's shared vaults, reduced to what the reminder list needs. */
export type ReminderVaultServer = { root: string; vaultRoots: string[] };

export type ReminderVaultInput = {
  /**
   * The vaults of the vault menu itself: the recent list on the desktop
   * (local folders and servers that are still known), the server's own vault
   * in the browser.
   */
  ownRoots: string[];
  /** Every server that offers shared vaults, with the roots of those this person is in. */
  servers: ReminderVaultServer[];
  /** The vault that is open; its reminders come from the live index instead. */
  activeRoot: string | null;
};

/**
 * Every vault whose reminders are read in the background: the ones the vault
 * menu lists, with the shared vaults listed under their server, minus the
 * open one. A shared vault counts only under a server that is itself in the
 * menu, exactly where the menu shows it.
 */
export function reminderVaultRoots({ ownRoots, servers, activeRoot }: ReminderVaultInput): string[] {
  const roots: string[] = [];

  for (const root of ownRoots) {
    roots.push(root);
    roots.push(...(servers.find((server) => server.root === root)?.vaultRoots ?? []));
  }

  return [...new Set(roots)].filter((root) => root !== activeRoot);
}
