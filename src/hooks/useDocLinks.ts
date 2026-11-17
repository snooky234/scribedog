import { useEffect, useRef } from "react";

import { platform } from "@/platform";
import type { DocLinkTarget, DocLinksApi } from "@/platform/types";
import { useAppStore } from "@/store/useAppStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

type UseDocLinksOptions = {
  folderPath: string | null;
  isLoading: boolean;
  filePaths: string[];
  selectedFilePath: string | null;
  /** Opens a document of the open vault the way a click in the tree does. */
  openDocument: (filePath: string) => Promise<void>;
  /** Opens another vault the way the vault menu does; this hook then opens the linked document in it. */
  openVault: (folderPath: string) => Promise<void>;
  /** The address names a document that does not exist (deleted, renamed, moved, no access). */
  onMissing: () => void;
  /** After a linked document was opened, e.g. to close the phone's sidebar sheet. */
  onOpened: () => void;
};

/**
 * Document addresses (`platform.docLinks`: the URL in the server edition,
 * nothing on the desktop), in two directions:
 *
 * Incoming, always: opening a vault whose document the address names opens
 * that document, ahead of "reopen the last note" (App skips that one for
 * such a vault), and back, forward, an edited address or a clicked link
 * opens the document it names, switching vaults first when it lives in
 * another one.
 *
 * Outgoing, only with the setting `docLinksInAddress`: every document opened
 * afterwards, however it was opened, goes into the address as a new history
 * entry. Off, the address is left alone, because the browser records every
 * address change in its history page, replaced ones included; an address a
 * link brought in is cleared once its document is open, so it never claims a
 * document that is no longer on screen.
 *
 * Only a path the vault listing contains is ever opened. A link to anything
 * else ends in a notice and the address put back, never in an empty or
 * broken editor.
 */
export function useDocLinks(options: UseDocLinksOptions): void {
  const { folderPath, isLoading, filePaths, selectedFilePath } = options;
  const docLinks = platform.docLinks;
  const inAddress = useEditorSettingsStore((state) => state.docLinksInAddress);
  const latest = useRef(options);
  latest.current = options;

  // The vault whose linked document has been looked at; until then the
  // address is left alone, so the link survives the vault's load.
  const appliedFolderRef = useRef<string | null>(null);

  useEffect(() => {
    if (!docLinks || !folderPath || isLoading || appliedFolderRef.current === folderPath) {
      return;
    }

    const isFirstVault = appliedFolderRef.current === null;
    appliedFolderRef.current = folderPath;
    const target = docLinks.current();

    if (!target) {
      return;
    }

    if (target.folderPath !== folderPath) {
      // At the start the link decided which vault opened; landing elsewhere
      // means its vault could not be opened (no longer shared with them).
      if (isFirstVault) {
        latest.current.onMissing();
        putAddressBack(docLinks);
      }

      return;
    }

    if (!filePaths.includes(target.filePath)) {
      latest.current.onMissing();
      putAddressBack(docLinks);
      return;
    }

    void latest.current.openDocument(target.filePath).then(() => {
      latest.current.onOpened();
      putAddressBack(docLinks);
    });
  }, [docLinks, folderPath, isLoading, filePaths]);

  useEffect(() => {
    if (!docLinks || !folderPath || appliedFolderRef.current !== folderPath) {
      return;
    }

    if (inAddress) {
      docLinks.show(selectedFilePath ? { folderPath, filePath: selectedFilePath } : null);
    }
  }, [docLinks, folderPath, selectedFilePath, inAddress]);

  // Switched off in the settings: the address that is there now goes, in
  // place. Only on the switch itself, never at the start, where the address
  // may be a link still waiting for its vault to load.
  const previousInAddressRef = useRef(inAddress);

  useEffect(() => {
    const wasInAddress = previousInAddressRef.current;
    previousInAddressRef.current = inAddress;

    if (docLinks && wasInAddress && !inAddress) {
      docLinks.show(null);
    }
  }, [docLinks, inAddress]);

  useEffect(() => {
    if (!docLinks) {
      return;
    }

    return docLinks.subscribe((target) => {
      void followLink(target);
    });

    async function followLink(target: DocLinkTarget | null) {
      const state = useAppStore.getState();

      if (!docLinks) {
        return;
      }

      // An address that names no document (edited by hand, a route this
      // version does not know) is put back, so the address bar never claims
      // something other than what is on screen.
      if (!target) {
        putAddressBack(docLinks);
        return;
      }

      if (target.filePath === state.selectedFilePath) {
        putAddressBack(docLinks);
        return;
      }

      if (target.folderPath !== state.folderPath) {
        // The vault's first-open effect above takes it from here.
        await latest.current.openVault(target.folderPath);

        if (useAppStore.getState().folderPath !== target.folderPath) {
          putAddressBack(docLinks);
        }

        return;
      }

      if (!state.filePaths.includes(target.filePath)) {
        latest.current.onMissing();
        putAddressBack(docLinks);
        return;
      }

      await latest.current.openDocument(target.filePath);

      if (useAppStore.getState().selectedFilePath === target.filePath) {
        latest.current.onOpened();
      }

      // Refused (an AI suggestion still open): back to the document that
      // stayed open. Opened with the setting off: the address goes again.
      putAddressBack(docLinks);
    }
  }, [docLinks]);
}

/**
 * The address as the setting wants it right now, in place of the current
 * history entry: the open document, or nothing with the setting off.
 */
function putAddressBack(docLinks: DocLinksApi): void {
  const inAddress = useEditorSettingsStore.getState().docLinksInAddress;
  const { folderPath, selectedFilePath } = useAppStore.getState();
  const target = inAddress && folderPath && selectedFilePath ? { folderPath, filePath: selectedFilePath } : null;

  docLinks.show(target, { replace: true });
}
