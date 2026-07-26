import { useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetailsFileInfoSection } from "@/components/editor/DetailsFileInfoSection";
import { DetailsLinksSection } from "@/components/editor/DetailsLinksSection";

type DetailsPanelProps = {
  folderPath: string | null;
  filePath: string | null;
  /** Live markdown of the open document, shared by both sections. */
  markdown: string;
  vaultFilePaths: string[];
  onRequestFileOpen?: (filePath: string) => void;
  onClose: () => void;
};

/**
 * Side panel with everything about the open note that is not the text itself:
 * its file info, then its links and backlinks. Sections read the live document,
 * so only the parts backed by disk (the vault scan, the timestamps) need the
 * refresh button — hence the single refreshId both of them watch.
 */
export function DetailsPanel({
  folderPath,
  filePath,
  markdown,
  vaultFilePaths,
  onRequestFileOpen,
  onClose
}: DetailsPanelProps) {
  const { t } = useTranslation();
  const [refreshId, setRefreshId] = useState(0);

  return (
    <aside className="details-sidebar" aria-label={t("detailsPanel.title")}>
      <div className="details-sidebar__header">
        <h3 className="details-sidebar__title">{t("detailsPanel.title")}</h3>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("detailsPanel.refresh")}
          title={t("detailsPanel.refresh")}
          onClick={() => setRefreshId((current) => current + 1)}
        >
          <RefreshCw />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("detailsPanel.close")}
          title={t("detailsPanel.close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>

      <ScrollArea className="details-sidebar__scroll">
        <DetailsFileInfoSection filePath={filePath} markdown={markdown} refreshId={refreshId} />
        <DetailsLinksSection
          folderPath={folderPath}
          filePath={filePath}
          markdown={markdown}
          vaultFilePaths={vaultFilePaths}
          refreshId={refreshId}
          onRequestFileOpen={onRequestFileOpen}
        />
      </ScrollArea>
    </aside>
  );
}
