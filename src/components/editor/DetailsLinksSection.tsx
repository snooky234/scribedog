import { useEffect, useMemo, useState } from "react";
import { FileText, Link2Off } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  collectBacklinks,
  collectOutgoingFileLinks,
  type Backlink,
  type BacklinkSource
} from "@/lib/editor/documentLinks";
import { getFileLinkLabel } from "@/lib/editor/fileLinks";
import { getRelativeDisplayPath, readMarkdownFile } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";

type DetailsLinksSectionProps = {
  folderPath: string | null;
  filePath: string | null;
  /** Live markdown of the open document — outgoing links update while typing. */
  markdown: string;
  vaultFilePaths: string[];
  /** Bumped by the panel's refresh button to rescan the vault. */
  refreshId: number;
  onRequestFileOpen?: (filePath: string) => void;
};

/**
 * Links and backlinks of the open note. Outgoing links come from the document
 * in the editor, backlinks from scanning the vault — with the unsaved content
 * of files that are already open, so a link just typed elsewhere is not
 * missing from the list.
 */
export function DetailsLinksSection({
  folderPath,
  filePath,
  markdown,
  vaultFilePaths,
  refreshId,
  onRequestFileOpen
}: DetailsLinksSectionProps) {
  const { t } = useTranslation();
  // null while the vault scan is running.
  const [backlinks, setBacklinks] = useState<Backlink[] | null>(null);

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
    <>
      <section className="details-sidebar__section">
        <h4 className="details-sidebar__section-title">
          {t("detailsPanel.outgoing", { count: outgoingLinks.length })}
        </h4>

        {outgoingLinks.length === 0 ? (
          <p className="details-sidebar__empty">{t("detailsPanel.noOutgoing")}</p>
        ) : (
          <ul className="details-sidebar__list">
            {outgoingLinks.map((link) =>
              link.targetFilePath ? (
                <li key={link.href}>
                  <button
                    type="button"
                    className="details-sidebar__item"
                    title={relativeLabel(link.targetFilePath)}
                    onClick={() => onRequestFileOpen?.(link.targetFilePath as string)}
                  >
                    <FileText aria-hidden="true" />
                    <span className="details-sidebar__item-label">
                      {getFileLinkLabel(link.targetFilePath)}
                    </span>
                  </button>
                </li>
              ) : (
                <li key={link.href}>
                  <span
                    className="details-sidebar__item details-sidebar__item--broken"
                    title={t("detailsPanel.brokenTarget")}
                  >
                    <Link2Off aria-hidden="true" />
                    <span className="details-sidebar__item-label">{link.href}</span>
                  </span>
                </li>
              )
            )}
          </ul>
        )}
      </section>

      <section className="details-sidebar__section">
        <h4 className="details-sidebar__section-title">
          {backlinks === null
            ? t("detailsPanel.backlinksLoading")
            : t("detailsPanel.backlinks", { count: backlinks.length })}
        </h4>

        {backlinks === null ? null : backlinks.length === 0 ? (
          <p className="details-sidebar__empty">{t("detailsPanel.noBacklinks")}</p>
        ) : (
          <ul className="details-sidebar__list">
            {backlinks.map((backlink) => (
              <li key={backlink.filePath}>
                <button
                  type="button"
                  className="details-sidebar__item"
                  title={relativeLabel(backlink.filePath)}
                  onClick={() => onRequestFileOpen?.(backlink.filePath)}
                >
                  <FileText aria-hidden="true" />
                  <span className="details-sidebar__item-label">
                    {getFileLinkLabel(backlink.filePath)}
                  </span>
                  {backlink.count > 1 ? (
                    <span className="details-sidebar__item-count">{backlink.count}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
