import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { countCharacters, countWords, estimateReadingMinutes } from "@/lib/editor/documentStats";
import { getFileTimestamps, type FileTimestamps } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";

type DetailsFileInfoSectionProps = {
  filePath: string | null;
  /** Live markdown — word count and reading time update while typing. */
  markdown: string;
  /** Bumped by the panel's refresh button to re-read the timestamps. */
  refreshId: number;
};

/** Stands in for a value the filesystem does not report. */
const UNKNOWN_VALUE = "—";

/**
 * Size and age of the open note: word count and reading time from the document
 * in the editor, created/modified from the file on disk. The timestamps are
 * re-read whenever the dirty flag flips, so saving updates the shown date
 * without a manual refresh.
 */
export function DetailsFileInfoSection({
  filePath,
  markdown,
  refreshId
}: DetailsFileInfoSectionProps) {
  const { t, i18n } = useTranslation();
  const isDirty = useAppStore((state) => state.isDirty);
  const [timestamps, setTimestamps] = useState<FileTimestamps | null>(null);

  const wordCount = useMemo(() => countWords(markdown), [markdown]);
  const characterCount = useMemo(() => countCharacters(markdown), [markdown]);
  const readingMinutes = estimateReadingMinutes(wordCount);

  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
    [i18n.language]
  );

  useEffect(() => {
    if (!filePath) {
      setTimestamps(null);
      return;
    }

    let isActive = true;

    void getFileTimestamps(filePath).then((result) => {
      if (isActive) {
        setTimestamps(result);
      }
    });

    return () => {
      isActive = false;
    };
  }, [filePath, isDirty, refreshId]);

  const formatTimestamp = (value: number | null | undefined) =>
    typeof value === "number" ? dateFormat.format(new Date(value)) : UNKNOWN_VALUE;

  return (
    <section className="details-sidebar__section">
      <h4 className="details-sidebar__section-title">{t("detailsPanel.fileInfo")}</h4>

      <dl className="details-sidebar__facts">
        <div className="details-sidebar__fact">
          <dt>{t("detailsPanel.words")}</dt>
          <dd>{numberFormat.format(wordCount)}</dd>
        </div>
        <div className="details-sidebar__fact">
          <dt>{t("detailsPanel.characters")}</dt>
          <dd>{numberFormat.format(characterCount)}</dd>
        </div>
        <div className="details-sidebar__fact">
          <dt>{t("detailsPanel.readingTime")}</dt>
          <dd>
            {readingMinutes === 0
              ? UNKNOWN_VALUE
              : t("detailsPanel.readingMinutes", { count: readingMinutes })}
          </dd>
        </div>
        <div className="details-sidebar__fact">
          <dt>{t("detailsPanel.createdAt")}</dt>
          <dd>{formatTimestamp(timestamps?.createdMs)}</dd>
        </div>
        <div className="details-sidebar__fact">
          <dt>{t("detailsPanel.modifiedAt")}</dt>
          <dd>{formatTimestamp(timestamps?.modifiedMs)}</dd>
        </div>
      </dl>
    </section>
  );
}
