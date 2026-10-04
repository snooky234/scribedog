import { Check, FolderCog, Plus, Users, X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Menu, MenuItem, MenuPopup, MenuPortal, MenuPositioner, MenuTrigger } from "@/components/ui/menu";
import { platform } from "@/platform";
import type { SharedVaultServer } from "@/platform/types";
import { useSharedVaultsStore } from "@/store/useSharedVaultsStore";

// A selector must return the same object for the same state, or the store
// hook re-renders forever; a fresh [] on every call would be a new one.
const NO_SERVERS: SharedVaultServer[] = [];

type SharedVaultSwitcherProps = {
  folderPath: string | null;
  isLoading: boolean;
  /** The vault name as the sidebar renders it (icon plus name). */
  label: ReactNode;
  title: string;
  onOpenVault: (folderPath: string) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
};

function useServers(): SharedVaultServer[] {
  return useSharedVaultsStore((state) => (state.servers.length > 0 ? state.servers : NO_SERVERS));
}

function Marker({ root, folderPath }: { root: string; folderPath: string | null }) {
  return root === folderPath ? (
    <Check className="size-4" aria-hidden="true" />
  ) : (
    <span className="size-4" aria-hidden="true" />
  );
}

/**
 * The shared vaults themselves, one row each.
 *
 * Its own component because the two shells put them in different places: in
 * the browser they hang under the vault name, which is the only menu there
 * (SharedVaultSwitcher below); in the desktop app they are indented under
 * their server in the vault menu it already has, next to the local folders.
 * `serverRoot` picks the server whose vaults to list; the desktop app can
 * have several and renders this once per server.
 */
export function SharedVaultItems({
  serverRoot,
  folderPath,
  onOpenVault,
  indented = false
}: {
  serverRoot?: string;
  folderPath: string | null;
  onOpenVault: (folderPath: string) => void;
  indented?: boolean;
}) {
  const servers = useServers();
  const api = platform.sharedVaults;
  const server = serverRoot === undefined ? servers[0] : servers.find((entry) => entry.root === serverRoot);

  if (!api || !server) {
    return null;
  }

  return (
    <>
      {server.overview.vaults.map((vault) => {
        const root = api.rootFor(server.root, vault.id);

        return (
          <MenuItem
            key={vault.id}
            className={
              indented
                ? "sidebar-panel__recent-folder-item sidebar-panel__recent-folder-item--nested"
                : "sidebar-panel__recent-folder-item"
            }
            title={vault.members.map((member) => member.user).join(", ")}
            onClick={() => onOpenVault(root)}
            data-testid="shared-vault-item"
          >
            <Marker root={root} folderPath={folderPath} />
            <Users className="size-4 sidebar-panel__recent-folder-kind" aria-hidden="true" />
            <span className="sidebar-panel__recent-folder-name">{vault.name}</span>
          </MenuItem>
        );
      })}
    </>
  );
}

/**
 * "New shared vault…", for the server that offers them (the first one when
 * none is named, which is the browser's single server).
 */
export function SharedVaultCreateAction({ serverRoot }: { serverRoot?: string }) {
  const { t } = useTranslation();
  const servers = useServers();
  const openDialog = useSharedVaultsStore((state) => state.openDialog);
  const target = serverRoot === undefined ? servers[0] : servers.find((entry) => entry.root === serverRoot);

  if (!platform.sharedVaults || !target) {
    return null;
  }

  return (
    <MenuItem onClick={() => openDialog({ kind: "create", serverRoot: target.root })} data-testid="shared-vault-new">
      <Plus className="size-4" aria-hidden="true" />
      {t("sharedVaults.menuNew")}
    </MenuItem>
  );
}

/**
 * "Manage vaults…", the last entry of the menu, below adding one. It covers
 * everything the menu lists: the local folders, the servers and their shared
 * vaults. Taking a folder off the list, or forgetting a server, has no other
 * place to live, and looking for that in the settings is not where anyone
 * looks first.
 */
export function SharedVaultManageAction() {
  const { t } = useTranslation();
  const servers = useServers();
  const openDialog = useSharedVaultsStore((state) => state.openDialog);
  const connectedCount = useSharedVaultsStore((state) => state.connectedCount);
  const hasSomething = platform.features.localFolders || connectedCount > 0 || servers.length > 0;

  if (!platform.sharedVaults || !hasSomething) {
    return null;
  }

  return (
    <MenuItem onClick={() => openDialog({ kind: "manage" })} data-testid="shared-vault-manage">
      <FolderCog className="size-4" aria-hidden="true" />
      {t("sharedVaults.menuManage")}
    </MenuItem>
  );
}

/** The instance's own vault; only the browser needs it as a row of its own. */
function OwnVaultItem({ folderPath, onOpenVault }: { folderPath: string | null; onOpenVault: (folderPath: string) => void }) {
  const { t } = useTranslation();
  const servers = useServers();
  const home = servers[0]?.root;

  if (home === undefined) {
    return null;
  }

  return (
    <MenuItem className="sidebar-panel__recent-folder-item" onClick={() => onOpenVault(home)}>
      <Marker root={home} folderPath={folderPath} />
      <span className="sidebar-panel__recent-folder-name">{t("sharedVaults.menuOwnVault")}</span>
    </MenuItem>
  );
}

/**
 * The vault name in the sidebar of a server that has shared vaults: the
 * person's own vault and every shared vault they are in, one click apart,
 * plus creating and managing them. Without shared vaults the name stays a
 * plain label (Sidebar.tsx), since there is nothing to switch to.
 */
export function SharedVaultSwitcher({ folderPath, isLoading, label, title, onOpenVault, onContextMenu }: SharedVaultSwitcherProps) {
  const { t } = useTranslation();
  const hasServers = useSharedVaultsStore((state) => state.servers.length > 0);

  if (!platform.sharedVaults || !hasServers) {
    return null;
  }

  return (
    <Menu onOpenChange={(open) => open && void useSharedVaultsStore.getState().refresh()}>
      <MenuTrigger
        render={
          <button
            type="button"
            className="sidebar-panel__folder"
            disabled={isLoading}
            title={title}
            aria-label={t("sharedVaults.switchVault")}
            onContextMenu={onContextMenu}
            data-testid="shared-vault-switcher"
          />
        }
      >
        {label}
      </MenuTrigger>
      <MenuPortal>
        <MenuPositioner align="start">
          <MenuPopup>
            <OwnVaultItem folderPath={folderPath} onOpenVault={onOpenVault} />
            <SharedVaultItems folderPath={folderPath} onOpenVault={onOpenVault} indented />
            <div className="editor-toolbar__menu-separator" role="separator" />
            <SharedVaultCreateAction />
            <SharedVaultManageAction />
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
}

/**
 * "<who> deleted <vault>": once per member, until they close it. Shown under
 * the vault name, where the vault used to be listed.
 */
export function SharedVaultNotices() {
  const { t } = useTranslation();
  const servers = useServers();
  const notices = servers.flatMap((server) =>
    server.overview.notices.map((notice) => ({ ...notice, serverRoot: server.root }))
  );

  if (notices.length === 0) {
    return null;
  }

  return (
    <div className="shared-vault-notices" role="status">
      {notices.map((notice) => (
        <div key={`${notice.serverRoot}:${notice.id}`} className="shared-vault-notices__item">
          <span>{t("sharedVaults.noticeDeleted", { by: notice.by, name: notice.vaultName })}</span>
          <button
            type="button"
            className="shared-vault-notices__dismiss"
            aria-label={t("sharedVaults.noticeDismiss")}
            title={t("sharedVaults.noticeDismiss")}
            onClick={() => void useSharedVaultsStore.getState().dismissNotice(notice.serverRoot, notice.id)}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
