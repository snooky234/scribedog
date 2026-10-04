import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { DeviceList } from "@/components/remote/DeviceList";
import { Button } from "@/components/ui/button";
import { useDismissOnOverlayClick } from "@/hooks/useDismissOnOverlayClick";
import i18n from "@/i18n";
import {
  getFolderBasename,
  getRecentFolderPathsSnapshot,
  removeRecentFolderPath,
  subscribeToRecentFolderPaths
} from "@/lib/fileSystem";
import {
  getRemoteVaultsSnapshot,
  isRemoteVaultPath,
  listRemoteDevices,
  remoteVaultFor,
  removeRemoteVault,
  renameRemoteVault,
  revokeRemoteDevice,
  subscribeToRemoteVaults
} from "@/lib/remoteVaults";
import { platform } from "@/platform";
import type { SharedVaultInfo } from "@/platform/types";
import { useAppStore } from "@/store/useAppStore";
import { findVault, useSharedVaultsStore } from "@/store/useSharedVaultsStore";

type SharedVaultDialogsProps = {
  /** Opens a vault the way the sidebar does (asks about unsaved changes first). */
  onOpenVault: (folderPath: string) => void;
  /** Opens a vault without asking: the open one is gone, nothing can be saved there. */
  onForceOpenVault: (folderPath: string) => void;
};

/** How long a deleted vault stays restorable; the server's rule (server/src/shared/model.ts). */
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(new Date(ms));
}

function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onEscape]);
}

function DialogFrame({
  labelledBy,
  onDismiss,
  children,
  wide = false,
  onSubmit
}: {
  labelledBy: string;
  onDismiss: () => void;
  children: ReactNode;
  wide?: boolean;
  onSubmit?: (event: FormEvent) => void;
}) {
  const dismissProps = useDismissOnOverlayClick(onDismiss);
  const panelClass = wide ? "unsaved-dialog__panel shared-vault-dialog__panel--wide" : "unsaved-dialog__panel";
  const panelProps = {
    className: panelClass,
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": labelledBy,
    onClick: (event: React.MouseEvent) => event.stopPropagation()
  } as const;

  return (
    <div className="unsaved-dialog" role="presentation" {...dismissProps}>
      {onSubmit ? (
        <form {...panelProps} onSubmit={onSubmit}>
          {children}
        </form>
      ) : (
        <div {...panelProps}>{children}</div>
      )}
    </div>
  );
}

function memberNames(vault: SharedVaultInfo, except: string | null): string {
  return vault.members
    .map((member) => member.user)
    .filter((user) => user !== except)
    .join(", ");
}

/** Create and edit share one form: a name and the people to share with. */
function SharedVaultForm({
  serverRoot,
  editing,
  onOpenVault
}: {
  serverRoot: string;
  editing: SharedVaultInfo | null;
  onOpenVault: (path: string) => void;
}) {
  const { t } = useTranslation();
  const overview = useSharedVaultsStore((state) => state.servers.find((server) => server.root === serverRoot)?.overview ?? null);
  const error = useSharedVaultsStore((state) => state.error);
  const isBusy = useSharedVaultsStore((state) => state.isBusy);
  const closeDialog = useSharedVaultsStore((state) => state.closeDialog);
  const [name, setName] = useState(editing?.name ?? "");
  const [members, setMembers] = useState<string[]>(
    editing ? editing.members.map((member) => member.user).filter((user) => user !== overview?.me) : []
  );
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEscape(!isBusy, closeDialog);

  const others = (overview?.people ?? []).filter((person) => person !== overview?.me);
  const canSubmit = !isBusy && name.trim().length > 0;

  const toggle = (user: string) =>
    setMembers((current) => (current.includes(user) ? current.filter((entry) => entry !== user) : [...current, user]));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    const store = useSharedVaultsStore.getState();

    if (editing) {
      if (await store.update(serverRoot, editing.id, { name: name.trim(), members })) {
        store.closeDialog();
      }

      return;
    }

    const created = await store.create(serverRoot, name.trim(), members);

    if (created && platform.sharedVaults) {
      store.closeDialog();
      onOpenVault(platform.sharedVaults.rootFor(serverRoot, created.id));
    }
  };

  return (
    <DialogFrame labelledBy="shared-vault-form-title" onDismiss={() => !isBusy && closeDialog()} onSubmit={(event) => void handleSubmit(event)}>
      <p className="unsaved-dialog__eyebrow">{t("sharedVaults.eyebrow")}</p>
      <h3 id="shared-vault-form-title">
        {editing ? t("sharedVaults.editTitle", { name: editing.name }) : t("sharedVaults.createTitle")}
      </h3>
      {editing ? null : <p className="unsaved-dialog__description">{t("sharedVaults.createDescription")}</p>}

      <div className="remote-vault-dialog__fields">
        <label className="ai-dialog__field">
          <span>{t("sharedVaults.nameLabel")}</span>
          <input
            ref={nameRef}
            type="text"
            maxLength={80}
            value={name}
            placeholder={t("sharedVaults.namePlaceholder")}
            disabled={isBusy}
            onChange={(event) => setName(event.target.value)}
            data-testid="shared-vault-name"
          />
        </label>

        <fieldset className="ai-dialog__field shared-vault-dialog__members">
          <legend>{t("sharedVaults.membersLabel")}</legend>
          {others.length === 0 ? (
            <p className="ai-dialog__model-hint">{t("sharedVaults.noPeople")}</p>
          ) : (
            others.map((person) => (
              <label key={person} className="shared-vault-dialog__member">
                <input
                  type="checkbox"
                  checked={members.includes(person)}
                  disabled={isBusy}
                  onChange={() => toggle(person)}
                />
                <span>{person}</span>
              </label>
            ))
          )}
          <small className="ai-dialog__model-hint">{t("sharedVaults.membersHint")}</small>
        </fieldset>
      </div>

      {error ? (
        <p className="ai-dialog__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="unsaved-dialog__actions">
        <Button type="button" variant="outline" disabled={isBusy} onClick={closeDialog}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!canSubmit} data-testid="shared-vault-submit">
          {isBusy ? t("sharedVaults.busy") : editing ? t("sharedVaults.save") : t("sharedVaults.create")}
        </Button>
      </div>
    </DialogFrame>
  );
}

/** Deleting names the date it becomes final, the members it disappears for, and that it can be undone until then. */
function SharedVaultDeleteDialog({
  serverRoot,
  vault,
  onAfterRemove
}: {
  serverRoot: string;
  vault: SharedVaultInfo;
  onAfterRemove: (serverRoot: string, id: string) => void;
}) {
  const { t } = useTranslation();
  const me = useSharedVaultsStore((state) => state.servers.find((server) => server.root === serverRoot)?.overview.me ?? null);
  const error = useSharedVaultsStore((state) => state.error);
  const isBusy = useSharedVaultsStore((state) => state.isBusy);
  const closeDialog = useSharedVaultsStore((state) => state.closeDialog);
  const cancelRef = useRef<HTMLElement>(null);
  const others = memberNames(vault, me);
  const date = formatDate(Date.now() + TRASH_RETENTION_MS);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEscape(!isBusy, closeDialog);

  const confirm = async () => {
    const store = useSharedVaultsStore.getState();

    if (await store.remove(serverRoot, vault.id)) {
      store.openDialog({ kind: "manage" });
      onAfterRemove(serverRoot, vault.id);
    }
  };

  return (
    <DialogFrame labelledBy="shared-vault-delete-title" onDismiss={() => !isBusy && closeDialog()}>
      <p className="unsaved-dialog__eyebrow">{t("sharedVaults.deleteEyebrow")}</p>
      <h3 id="shared-vault-delete-title">{t("sharedVaults.deleteTitle", { name: vault.name })}</h3>
      <p className="unsaved-dialog__description">
        {others
          ? t("sharedVaults.deleteDescription", { members: others, date })
          : t("sharedVaults.deleteDescriptionAlone", { date })}
      </p>

      {error ? (
        <p className="ai-dialog__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="unsaved-dialog__actions">
        <Button ref={cancelRef} type="button" variant="outline" disabled={isBusy} onClick={closeDialog}>
          {t("common.cancel")}
        </Button>
        <Button type="button" variant="destructive" disabled={isBusy} onClick={() => void confirm()} data-testid="shared-vault-delete-confirm">
          {isBusy ? t("sharedVaults.busy") : t("sharedVaults.deleteConfirm")}
        </Button>
      </div>
    </DialogFrame>
  );
}

/**
 * The servers this app has been given, in the same dialog as the shared
 * vaults: both are "vaults that are not a folder on this machine", and the
 * one place people look for them is the vault menu. Only the desktop app has
 * them; in the browser there is one server, the one it came from.
 *
 * Signed-in devices and revoking a single access key stay in the settings:
 * that is account housekeeping, not something you do while picking a vault.
 */
/**
 * The local folders in the vault menu. "Close" takes one off that list; the
 * folder and its notes stay exactly where they are, which is what the hint
 * below the list says.
 */
function LocalFolderSection() {
  const { t } = useTranslation();
  const recent = useSyncExternalStore(subscribeToRecentFolderPaths, getRecentFolderPathsSnapshot);
  const folders = useMemo(() => recent.filter((path) => !isRemoteVaultPath(path)), [recent]);
  const [confirmClose, setConfirmClose] = useState<string | null>(null);

  if (!platform.features.localFolders) {
    return null;
  }

  const close = (path: string) => {
    setConfirmClose(null);
    removeRecentFolderPath(path);

    if (useAppStore.getState().folderPath === path) {
      useAppStore.getState().closeFolder();
    }
  };

  return (
    <>
      <h4 className="shared-vault-dialog__heading">{t("sharedVaults.foldersHeading")}</h4>
      {folders.length === 0 ? (
        <p className="ai-dialog__model-hint">{t("sharedVaults.foldersEmpty")}</p>
      ) : (
        <ul className="shared-vault-dialog__list" data-testid="local-folder-list">
          {folders.map((path) => (
            <li key={path} className="shared-vault-dialog__row">
              <div className="shared-vault-dialog__row-text">
                <strong>{getFolderBasename(path)}</strong>
                <span>{path}</span>
              </div>
              <div className="shared-vault-dialog__row-actions">
                {confirmClose === path ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => close(path)}
                    data-testid="local-folder-close-confirm"
                  >
                    {t("sharedVaults.folderCloseConfirm")}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="destructive" onClick={() => setConfirmClose(path)}>
                    {t("sharedVaults.folderClose")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {folders.length > 0 ? <p className="ai-dialog__model-hint">{t("sharedVaults.foldersHint")}</p> : null}
    </>
  );
}

/**
 * The servers this app knows, so their vaults can be opened from here. Only
 * opening: disconnecting lives in the settings, next to the device list it
 * belongs with, and two buttons for one action that behave differently (the
 * settings can forget a server the server itself already signed out) is how
 * the two drift apart.
 */
function ServerVaultSection() {
  const { t } = useTranslation();
  const openDialog = useSharedVaultsStore((state) => state.openDialog);
  const servers = useSyncExternalStore(subscribeToRemoteVaults, getRemoteVaultsSnapshot);

  if (!platform.features.remoteVaults) {
    return null;
  }

  return (
    <>
      <h4 className="shared-vault-dialog__heading">{t("sharedVaults.serversHeading")}</h4>
      {servers.length === 0 ? (
        <p className="ai-dialog__model-hint">{t("sharedVaults.serversEmpty")}</p>
      ) : (
        <ul className="shared-vault-dialog__list" data-testid="server-vault-list">
          {servers.map((entry) => (
            <li key={entry.root} className="shared-vault-dialog__row">
              <div className="shared-vault-dialog__row-text">
                <strong>{entry.name}</strong>
                <span>{entry.url}</span>
              </div>
              <div className="shared-vault-dialog__row-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => openDialog({ kind: "server", serverRoot: entry.root })}
                  data-testid="server-vault-edit"
                >
                  {t("sharedVaults.edit")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {servers.length > 0 ? <p className="ai-dialog__model-hint">{t("sharedVaults.serversHint")}</p> : null}
    </>
  );
}

/**
 * One server: what the sidebar calls it, which devices hold an access key,
 * and the way out of the connection. Everything about a server that is not
 * "open it" lives here, so the vault menu stays one list of vaults.
 */
function ServerEditDialog({ serverRoot, onAfterDisconnect }: { serverRoot: string; onAfterDisconnect: () => void }) {
  const { t } = useTranslation();
  const openDialog = useSharedVaultsStore((state) => state.openDialog);
  const servers = useSyncExternalStore(subscribeToRemoteVaults, getRemoteVaultsSnapshot);
  const entry = servers.find((candidate) => candidate.root === serverRoot) ?? null;
  const [name, setName] = useState(() => remoteVaultFor(serverRoot)?.name ?? "");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const back = () => openDialog({ kind: "manage" });

  useEscape(!isBusy, back);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  if (!entry) {
    return null;
  }

  const disconnect = async ({ revoke = true }: { revoke?: boolean } = {}) => {
    setConfirmDisconnect(false);
    setIsBusy(true);
    setError(null);

    try {
      await removeRemoteVault(serverRoot, { revoke });
      removeRecentFolderPath(serverRoot);

      if (useAppStore.getState().folderPath === serverRoot) {
        useAppStore.getState().closeFolder();
      }

      // The menu counts the servers and lists their shared vaults; both changed.
      await useSharedVaultsStore.getState().refresh();
      onAfterDisconnect();
      back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("remoteVaults.removeFailed"));
    } finally {
      setIsBusy(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    renameRemoteVault(serverRoot, name);
    back();
  };

  return (
    <DialogFrame labelledBy="shared-vault-server-title" onDismiss={() => !isBusy && back()} wide onSubmit={save}>
      <p className="unsaved-dialog__eyebrow">{t("sharedVaults.eyebrow")}</p>
      <h3 id="shared-vault-server-title">{t("sharedVaults.serverEditTitle", { name: entry.name })}</h3>

      <div className="shared-vault-dialog__scroll">
        <label className="ai-dialog__field">
          <span>{t("sharedVaults.serverNameLabel")}</span>
          <input
            ref={nameRef}
            type="text"
            maxLength={80}
            value={name}
            disabled={isBusy}
            onChange={(event) => setName(event.target.value)}
            data-testid="server-name"
          />
        </label>
        <p className="ai-dialog__model-hint">{entry.url}</p>

        <h4 className="shared-vault-dialog__heading">{t("sharedVaults.serverDevicesHeading")}</h4>
        <DeviceList
          load={() => listRemoteDevices(serverRoot)}
          revoke={(id) => revokeRemoteDevice(serverRoot, id)}
          // Revoking this app's own key is the same as disconnecting, minus
          // the round trip to the server.
          onRevokedCurrent={() => void disconnect({ revoke: false })}
        />

        {error ? (
          <p className="ai-dialog__error" role="alert">
            {error}
          </p>
        ) : null}

        <p className="ai-dialog__model-hint">{t("sharedVaults.serverDisconnectHint")}</p>
      </div>

      <div className="unsaved-dialog__actions shared-vault-dialog__footer">
        {confirmDisconnect ? (
          <Button
            type="button"
            variant="destructive"
            disabled={isBusy}
            onClick={() => void disconnect()}
            data-testid="server-disconnect-confirm"
          >
            {t("sharedVaults.serverDisconnectConfirm")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="destructive"
            disabled={isBusy}
            onClick={() => setConfirmDisconnect(true)}
            data-testid="server-disconnect"
          >
            {t("sharedVaults.serverDisconnect")}
          </Button>
        )}
        <span className="shared-vault-dialog__spacer" />
        <Button type="button" variant="outline" disabled={isBusy} onClick={back}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isBusy || !name.trim()}>
          {t("sharedVaults.save")}
        </Button>
      </div>
    </DialogFrame>
  );
}

function SharedVaultsManageDialog({
  onAfterLeave
}: {
  onAfterLeave: (serverRoot: string, id: string) => void;
}) {
  const { t } = useTranslation();
  const servers = useSharedVaultsStore((state) => state.servers);
  const error = useSharedVaultsStore((state) => state.error);
  const isBusy = useSharedVaultsStore((state) => state.isBusy);
  const closeDialog = useSharedVaultsStore((state) => state.closeDialog);
  const openDialog = useSharedVaultsStore((state) => state.openDialog);
  const [confirmLeave, setConfirmLeave] = useState<string | null>(null);

  useEscape(!isBusy, closeDialog);

  // One flat list over every server; a vault carries the server it is on, so
  // the rows act on the right one.
  const vaults = servers.flatMap((server) => server.overview.vaults.map((vault) => ({ ...vault, serverRoot: server.root })));
  const trash = servers.flatMap((server) => server.overview.trash.map((vault) => ({ ...vault, serverRoot: server.root })));
  const hasSharedVaults = servers.length > 0;

  const leave = async (serverRoot: string, id: string) => {
    setConfirmLeave(null);

    if (await useSharedVaultsStore.getState().leave(serverRoot, id)) {
      onAfterLeave(serverRoot, id);
    }
  };

  return (
    <DialogFrame labelledBy="shared-vaults-manage-title" onDismiss={() => !isBusy && closeDialog()} wide>
      <p className="unsaved-dialog__eyebrow">{t("sharedVaults.eyebrow")}</p>
      <h3 id="shared-vaults-manage-title">{t("sharedVaults.manageTitle")}</h3>

      {/* Only this part scrolls, so "Close" stays reachable at any list length. */}
      <div className="shared-vault-dialog__scroll">
        <LocalFolderSection />

        <ServerVaultSection />

        {/* Only where a server actually offers them; a local folder has none. */}
        {hasSharedVaults ? <h4 className="shared-vault-dialog__heading">{t("sharedVaults.sharedHeading")}</h4> : null}

        {!hasSharedVaults ? null : vaults.length === 0 ? (
          <p className="ai-dialog__model-hint">{t("sharedVaults.manageEmpty")}</p>
        ) : (
          <ul className="shared-vault-dialog__list" data-testid="shared-vault-list">
            {vaults.map((vault) => (
              <li key={vault.id} className="shared-vault-dialog__row">
                <div className="shared-vault-dialog__row-text">
                  <strong>{vault.name}</strong>
                  <span>
                    {vault.isCreator ? t("sharedVaults.createdByYou") : t("sharedVaults.createdBy", { name: vault.creator })}
                    {" · "}
                    {t("sharedVaults.membersList", { names: memberNames(vault, null) })}
                  </span>
                </div>
                <div className="shared-vault-dialog__row-actions">
                  {vault.isCreator ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => openDialog({ kind: "edit", serverRoot: vault.serverRoot, id: vault.id })}
                      >
                        {t("sharedVaults.edit")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={isBusy}
                        onClick={() => openDialog({ kind: "delete", serverRoot: vault.serverRoot, id: vault.id })}
                      >
                        {t("sharedVaults.delete")}
                      </Button>
                    </>
                  ) : confirmLeave === vault.id ? (
                    <Button type="button" size="sm" variant="destructive" disabled={isBusy} onClick={() => void leave(vault.serverRoot, vault.id)}>
                      {t("sharedVaults.leaveConfirm")}
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="destructive" disabled={isBusy} onClick={() => setConfirmLeave(vault.id)}>
                      {t("sharedVaults.leave")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {trash.length > 0 ? (
          <>
            <h4 className="shared-vault-dialog__heading">{t("sharedVaults.trashHeading")}</h4>
            <ul className="shared-vault-dialog__list" data-testid="shared-vault-trash">
              {trash.map((vault) => (
                <li key={vault.id} className="shared-vault-dialog__row">
                  <div className="shared-vault-dialog__row-text">
                    <strong>{vault.name}</strong>
                    <span>{t("sharedVaults.trashUntil", { date: formatDate(vault.purgeAt) })}</span>
                  </div>
                  <div className="shared-vault-dialog__row-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => void useSharedVaultsStore.getState().restore(vault.serverRoot, vault.id)}
                    >
                      {t("sharedVaults.restore")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {error ? (
          <p className="ai-dialog__error" role="alert">
            {error}
          </p>
        ) : null}

      </div>

      <div className="unsaved-dialog__actions shared-vault-dialog__footer">
        <Button type="button" disabled={isBusy} onClick={closeDialog}>
          {t("sharedVaults.close")}
        </Button>
      </div>
    </DialogFrame>
  );
}

/** The open shared vault was deleted, or the person taken off it, while it was open. */
function SharedVaultLostDialog({ onForceOpenVault }: { onForceOpenVault: (path: string) => void }) {
  const { t } = useTranslation();
  const lost = useSharedVaultsStore((state) => state.lost);
  const buttonRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (lost) {
      buttonRef.current?.focus();
    }
  }, [lost]);

  if (!lost || !platform.sharedVaults) {
    return null;
  }

  const home = platform.sharedVaults.parseRoot(lost.folderPath)?.serverRoot ?? null;
  const goHome = () => {
    useSharedVaultsStore.getState().clearLost();

    if (home) {
      onForceOpenVault(home);
    }
  };

  return (
    <DialogFrame labelledBy="shared-vault-lost-title" onDismiss={goHome}>
      <p className="unsaved-dialog__eyebrow">{t("sharedVaults.eyebrow")}</p>
      <h3 id="shared-vault-lost-title">
        {lost.reason === "deleted"
          ? t("sharedVaults.lostDeletedTitle", { name: lost.name })
          : t("sharedVaults.lostRemovedTitle", { name: lost.name })}
      </h3>
      <p className="unsaved-dialog__description">
        {lost.reason === "deleted" ? t("sharedVaults.lostDeletedDescription") : t("sharedVaults.lostRemovedDescription")}
      </p>
      <div className="unsaved-dialog__actions">
        <Button ref={buttonRef} type="button" onClick={goHome} data-testid="shared-vault-lost-home">
          {t("sharedVaults.backToOwn")}
        </Button>
      </div>
    </DialogFrame>
  );
}

/**
 * Every dialog of the shared vaults, driven by useSharedVaultsStore. Leaving
 * or deleting the vault that is open right now takes the user back to their
 * own one, since there is nothing left to show.
 */
export function SharedVaultDialogs({ onOpenVault, onForceOpenVault }: SharedVaultDialogsProps) {
  const dialog = useSharedVaultsStore((state) => state.dialog);
  const servers = useSharedVaultsStore((state) => state.servers);

  const leaveIfOpen = (serverRoot: string, id: string) => {
    const api = platform.sharedVaults;

    if (api && useAppStore.getState().folderPath === api.rootFor(serverRoot, id)) {
      // Back to the server's own vault, which is its root.
      onForceOpenVault(serverRoot);
    }
  };

  const target =
    dialog && (dialog.kind === "edit" || dialog.kind === "delete")
      ? findVault(servers, dialog.serverRoot, dialog.id)
      : null;

  return (
    <>
      {dialog?.kind === "create" ? (
        <SharedVaultForm key="create" serverRoot={dialog.serverRoot} editing={null} onOpenVault={onOpenVault} />
      ) : null}
      {dialog?.kind === "edit" && target ? (
        <SharedVaultForm key={`edit-${target.id}`} serverRoot={dialog.serverRoot} editing={target} onOpenVault={onOpenVault} />
      ) : null}
      {dialog?.kind === "delete" && target ? (
        <SharedVaultDeleteDialog serverRoot={dialog.serverRoot} vault={target} onAfterRemove={leaveIfOpen} />
      ) : null}
      {dialog?.kind === "server" ? (
        <ServerEditDialog
          key={`server-${dialog.serverRoot}`}
          serverRoot={dialog.serverRoot}
          onAfterDisconnect={() => undefined}
        />
      ) : null}
      {dialog?.kind === "manage" ? (
        <SharedVaultsManageDialog onAfterLeave={leaveIfOpen} />
      ) : null}
      <SharedVaultLostDialog onForceOpenVault={onForceOpenVault} />
    </>
  );
}
