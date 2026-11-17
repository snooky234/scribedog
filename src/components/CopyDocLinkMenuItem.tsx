import { Link } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { writeClipboardText } from "@/lib/editor/selectionClipboard";
import { platform } from "@/platform";
import { useAppStore } from "@/store/useAppStore";
import { useNoticeStore } from "@/store/useNoticeStore";

/**
 * Puts a document's address (see useDocLinks) on the clipboard. The way to a
 * link that does not depend on the address bar, which is left alone unless
 * the person switched that on. Only where documents have addresses: the
 * server edition in the browser.
 */
export async function copyDocLink(filePath: string): Promise<void> {
  const folderPath = useAppStore.getState().folderPath;
  const url = folderPath ? platform.docLinks?.urlFor({ folderPath, filePath }) : null;
  const { show } = useNoticeStore.getState();

  if (!url) {
    return;
  }

  show(i18n.t((await writeClipboardText(url)) ? "app.docLinkCopied" : "app.docLinkCopyFailed"));
}

/**
 * "Copy link" for the context menus of the tree and the "In progress" list,
 * styled like their other entries. The document menu of phone and tablet
 * calls copyDocLink itself.
 */
export function CopyDocLinkMenuItem({ filePath, onDone }: { filePath: string; onDone: () => void }) {
  const { t } = useTranslation();
  // Only what the listing has: an address of anything else (a folder note
  // not written yet) would open as "not found".
  const isListed = useAppStore((state) => state.filePaths.includes(filePath));

  if (!platform.docLinks || !isListed) {
    return null;
  }

  return (
    <button
      type="button"
      role="menuitem"
      className="file-tree-context-menu__item"
      data-testid="copy-doc-link-menu-item"
      onClick={() => {
        onDone();
        void copyDocLink(filePath);
      }}
    >
      <Link aria-hidden="true" />
      {t("app.copyDocLink")}
    </button>
  );
}
