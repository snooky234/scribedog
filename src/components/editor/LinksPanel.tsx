import { useEffect, useMemo, useState } from "react";
import { FileText, Link2Off, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  collectBacklinks,
  collectOutgoingFileLinks,
  type Backlink,
  type BacklinkSource
} from "@/lib/editor/documentLinks";
import { getFileLinkLabel } from "@/lib/editor/fileLinks";
import { getRelativeDisplayPath, readMarkdownFile } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";

type LinksPanelProps = {
  folderPath: string | null;
  filePath: string | null;
  /** Live markdown of the open document — outgoing links update while typing. */
  markdown: string;
  vaultFilePaths: string[];
  onRequestFileOpen?: (filePath: string) => void;
  onClose: () => void;
};

/**
 * Links and backlinks of the open note. Outgoing links come from the document
 * in the editor, backlinks from scanning the vault — with the unsaved content
 * of files that are already open, so a link just typed elsewhere is not
 * missing from the list.
 */
export function LinksPanel({
  folderPath,
  filePath,
  markdown,
  vaultFilePaths,
  onRequestFileOpen,
  onClose
}: LinksPanelProps) {
  const { t } = useTranslation();
  // null while the vault scan is running.
  const [backlinks, setBacklinks] = useState<Backlink[] | null>(null);
  const [refreshId, setRefreshId] = useState(0);

  const outgoingLinks = useMemo(
    () => (filePath ? collectOutgoingFileLinks(markdown, filePath, vaultFilePaths) : []),
    [markdown, filePath, vaultFilePaths]
  );

  useEffect(() => {
    if (!filePath) {
      setBacklinks([]);
      return;
    }

    let isActive = true;
    setBacklinks(null);

    const scanVault = async () => {
      const { fileDocuments } = useAppStore.getState();
      const sources = await Promise.all(
        vaultFilePaths
          .filter((candidatePath) => candidatePath !== filePath)
          .map(async (candidatePath): Promise<BacklinkSource> => {
            const openDocument = fileDocuments[candidatePath];

            if (openDocument) {
              return { filePath: candidatePath, markdown: openDocument.content };
            }

            try {
              return { filePath: candidatePath, markdown: await readMarkdownFile(candidatePath) };
            } catch {
              // A file that cannot be read simply contributes no backlinks.
              return { filePath: candidatePath, markdown: "" };
            }
          })
      );

      if (isActive) {
        setBacklinks(collectBacklinks(filePath, sources, vaultFilePaths));
      }
    };

    void scanVault();

    return () => {
      isActive = false;
    };
  }, [filePath, vaultFilePaths, refreshId]);

  const relativeLabel = (targetPath: string) =>
    folderPath ? getRelativeDisplayPath(folderPath, targetPath) : targetPath;

  return (
    <aside className="links-panel" aria-label={t("linksPanel.title")}>
      <div className="links-panel__header">
        <h3 className="links-panel__title">{t("linksPanel.title")}</h3>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("linksPanel.refresh")}
          title={t("linksPanel.refresh")}
          onClick={() => setRefreshId((current) => current + 1)}
        >
          <RefreshCw />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("linksPanel.close")}
          title={t("linksPanel.close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>

      <ScrollArea className="links-panel__scroll">
        <section className="links-panel__section">
          <h4 className="links-panel__section-title">
            {t("linksPanel.outgoing", { count: outgoingLinks.length })}
          </h4>

          {outgoingLinks.length === 0 ? (
            <p className="links-panel__empty">{t("linksPanel.noOutgoing")}</p>
          ) : (
            <ul className="links-panel__list">
              {outgoingLinks.map((link) =>
                link.targetFilePath ? (
                  <li key={link.href}>
                    <button
                      type="button"
                      className="links-panel__item"
                      title={relativeLabel(link.targetFilePath)}
                      onClick={() => onRequestFileOpen?.(link.targetFilePath as string)}
                    >
                      <FileText aria-hidden="true" />
                      <span className="links-panel__item-label">
                        {getFileLinkLabel(link.targetFilePath)}
                      </span>
                    </button>
                  </li>
                ) : (
                  <li key={link.href}>
                    <span
                      className="links-panel__item links-panel__item--broken"
                      title={t("linksPanel.brokenTarget")}
                    >
                      <Link2Off aria-hidden="true" />
                      <span className="links-panel__item-label">{link.href}</span>
                    </span>
                  </li>
                )
              )}
            </ul>
          )}
        </section>

        <section className="links-panel__section">
          <h4 className="links-panel__section-title">
            {backlinks === null
              ? t("linksPanel.backlinksLoading")
              : t("linksPanel.backlinks", { count: backlinks.length })}
          </h4>

          {backlinks === null ? null : backlinks.length === 0 ? (
            <p className="links-panel__empty">{t("linksPanel.noBacklinks")}</p>
          ) : (
            <ul className="links-panel__list">
              {backlinks.map((backlink) => (
                <li key={backlink.filePath}>
                  <button
                    type="button"
                    className="links-panel__item"
                    title={relativeLabel(backlink.filePath)}
                    onClick={() => onRequestFileOpen?.(backlink.filePath)}
                  >
                    <FileText aria-hidden="true" />
                    <span className="links-panel__item-label">
                      {getFileLinkLabel(backlink.filePath)}
                    </span>
                    {backlink.count > 1 ? (
                      <span className="links-panel__item-count">{backlink.count}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </ScrollArea>
    </aside>
  );
}
