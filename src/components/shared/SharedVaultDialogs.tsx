import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import i18n from "@/i18n";
import { platform } from "@/platform";
import type { SharedVaultInfo } from "@/platform/types";
import { useAppStore } from "@/store/useAppStore";
import { useSharedVaultsStore } from "@/store/useSharedVaultsStore";

type SharedVaultDialogsProps = {
  /** Opens a vault the way the sidebar does (asks about unsaved changes first). */
  onOpenVault: (folderPath: string) => void;
  /** Opens a vault without asking: the open one is gone, nothing can be saved there. */
  onForceOpenVault: (folderPath: string) => void;
};

// A selector must return the same object for the same state, or the store
// hook re-renders forever; a fresh [] on every call would be a new one.
const NO_VAULTS: SharedVaultInfo[] = [];

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
  const panelClass = wide ? "unsaved-dialog__panel shared-vault-dialog__panel--wide" : "unsaved-dialog__panel";
  const panelProps = {
    className: panelClass,
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": labelledBy,
    onClick: (event: React.MouseEvent) => event.stopPropagation()
  } as const;

  return (
    <div className="unsaved-dialog" role="presentation" onClick={onDismiss}>
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
function SharedVaultForm({ editing, onOpenVault }: { editing: SharedVaultInfo | null; onOpenVault: (path: string) => void }) {
  const { t } = useTranslation();
  const overview = useSharedVaultsStore((state) => state.overview);
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
      if (await store.update(editing.id, { name: name.trim(), members })) {
        store.closeDialog();
      }

      return;
    }

    const created = await store.create(name.trim(), members);

    if (created && platform.sharedVaults) {
      store.closeDialog();
      onOpenVault(platform.sharedVaults.rootFor(created.id));
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
function SharedVaultDeleteDialog({ vault, onAfterRemove }: { vault: SharedVaultInfo; onAfterRemove: (id: string) => void }) {
  const { t } = useTranslation();
  const me = useSharedVaultsStore((state) => state.overview?.me ?? null);
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

    if (await store.remove(vault.id)) {
      store.openDialog({ kind: "manage" });
      onAfterRemove(vault.id);
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

function SharedVaultsManageDialog({ onOpenVault, onAfterLeave }: { onOpenVault: (path: string) => void; onAfterLeave: (id: string) => void }) {
  const { t } = useTranslation();
  const overview = useSharedVaultsStore((state) => state.overview);
  const error = useSharedVaultsStore((state) => state.error);
  const isBusy = useSharedVaultsStore((state) => state.isBusy);
  const closeDialog = useSharedVaultsStore((state) => state.closeDialog);
  const openDialog = useSharedVaultsStore((state) => state.openDialog);
  const [confirmLeave, setConfirmLeave] = useState<string | null>(null);

  useEscape(!isBusy, closeDialog);

  const vaults = overview?.vaults ?? [];
  const trash = overview?.trash ?? [];

  const leave = async (id: string) => {
    setConfirmLeave(null);

    if (await useSharedVaultsStore.getState().leave(id)) {
      onAfterLeave(id);
    }
  };

  return (
    <DialogFrame labelledBy="shared-vaults-manage-title" onDismiss={() => !isBusy && closeDialog()} wide>
      <p className="unsaved-dialog__eyebrow">{t("sharedVaults.eyebrow")}</p>
      <h3 id="shared-vaults-manage-title">{t("sharedVaults.manageTitle")}</h3>

      {vaults.length === 0 ? (
        <p className="unsaved-dialog__description">{t("sharedVaults.manageEmpty")}</p>
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isBusy || !platform.sharedVaults}
                  onClick={() => {
                    closeDialog();
                    onOpenVault(platform.sharedVaults!.rootFor(vault.id));
                  }}
                >
                  {t("sharedVaults.open")}
                </Button>
                {vault.isCreator ? (
                  <>
                    <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={() => openDialog({ kind: "edit", id: vault.id })}>
                      {t("sharedVaults.edit")}
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={() => openDialog({ kind: "delete", id: vault.id })}>
                      {t("sharedVaults.delete")}
                    </Button>
                  </>
                ) : confirmLeave === vault.id ? (
                  <Button type="button" size="sm" variant="destructive" disabled={isBusy} onClick={() => void leave(vault.id)}>
                    {t("sharedVaults.leaveConfirm")}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={() => setConfirmLeave(vault.id)}>
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
                    onClick={() => void useSharedVaultsStore.getState().restore(vault.id)}
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

      <div className="unsaved-dialog__actions">
        <Button type="button" variant="outline" disabled={isBusy} onClick={() => openDialog({ kind: "create" })}>
          {t("sharedVaults.menuNew")}
        </Button>
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

  const home = platform.sharedVaults.homeRoot;
  const goHome = () => {
    useSharedVaultsStore.getState().clearLost();
    onForceOpenVault(home);
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
  const vaults = useSharedVaultsStore((state) => state.overview?.vaults ?? NO_VAULTS);

  const leaveIfOpen = (id: string) => {
    const api = platform.sharedVaults;

    if (api && useAppStore.getState().folderPath === api.rootFor(id)) {
      onForceOpenVault(api.homeRoot);
    }
  };

  const target = dialog && (dialog.kind === "edit" || dialog.kind === "delete") ? vaults.find((vault) => vault.id === dialog.id) ?? null : null;

  return (
    <>
      {dialog?.kind === "create" ? <SharedVaultForm key="create" editing={null} onOpenVault={onOpenVault} /> : null}
      {dialog?.kind === "edit" && target ? <SharedVaultForm key={`edit-${target.id}`} editing={target} onOpenVault={onOpenVault} /> : null}
      {dialog?.kind === "delete" && target ? <SharedVaultDeleteDialog vault={target} onAfterRemove={leaveIfOpen} /> : null}
      {dialog?.kind === "manage" ? <SharedVaultsManageDialog onOpenVault={onOpenVault} onAfterLeave={leaveIfOpen} /> : null}
      <SharedVaultLostDialog onForceOpenVault={onForceOpenVault} />
    </>
  );
}
