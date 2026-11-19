import { useState } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetailsFileInfoSection } from "@/components/editor/DetailsFileInfoSection";
import { DetailsLinksSection } from "@/components/editor/DetailsLinksSection";
import { DetailsOutlineSection } from "@/components/editor/DetailsOutlineSection";
import { DetailsPlacemarksSection } from "@/components/editor/DetailsPlacemarksSection";
import { useDocumentOutline } from "@/components/editor/useDocumentOutline";
import type { OutlineHeading } from "@/lib/editor/documentOutline";

type DetailsPanelProps = {
  editor: TipTapEditor | null;
  folderPath: string | null;
  filePath: string | null;
  /** Live markdown of the open document, shared by the text-based sections. */
  markdown: string;
  vaultFilePaths: string[];
  /** Bumped when the editor hands keyboard focus to the outline (Tab). */
  outlineFocusRequestId: number;
  onJumpToHeading: (heading: OutlineHeading) => void;
  onRequestEditorFocus: () => void;
  onRequestFileOpen?: (filePath: string) => void;
  onClose: () => void;
  /** Current panel width in pixels, set by the resizer handle in Editor.tsx. */
  width: number;
};

/**
 * Side panel with everything about the open note that is not the text itself:
 * its outline, its file info, then its links and backlinks. Sections read the
 * live document, so only the parts backed by disk (the vault scan, the
 * timestamps) need the refresh button — hence the single refreshId they watch.
 */
export function DetailsPanel({
  editor,
  folderPath,
  filePath,
  markdown,
  vaultFilePaths,
  outlineFocusRequestId,
  onJumpToHeading,
  onRequestEditorFocus,
  onRequestFileOpen,
  onClose,
  width
}: DetailsPanelProps) {
  const { t } = useTranslation();
  const [refreshId, setRefreshId] = useState(0);
  const outline = useDocumentOutline(editor);

  return (
    <aside
      className="details-sidebar"
      aria-label={t("detailsPanel.title")}
      style={{ "--details-panel-width": `${width}px` } as React.CSSProperties}
    >
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
        <DetailsOutlineSection
          headings={outline.headings}
          activeIndex={outline.activeIndex}
          focusRequestId={outlineFocusRequestId}
          onJump={onJumpToHeading}
          onRequestEditorFocus={onRequestEditorFocus}
        />
        <DetailsPlacemarksSection editor={editor} />
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
