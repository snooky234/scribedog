import { useMemo, type CSSProperties } from "react";
import { Bold, Check, FileText, Folder, Italic, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { resolveTheme, type CustomTheme } from "@/lib/theme/themeFormat";

/** What the preview shows: the app, the app with the paper sheet (dark
 *  themes only), or Zen mode's page. */
export type ThemePreviewView = "app" | "paper" | "zen";

type ThemePreviewProps = {
  theme: CustomTheme;
  view: ThemePreviewView;
  /** Adds the "In progress" list above the notes. It is only worth the
   *  space once the list has colours of its own: then the same note shows
   *  twice, one above the other, which is the comparison being made. While
   *  the two match, the tree below already shows it. */
  withWorkingSet?: boolean;
};

function asStyle(variables: Record<string, string>, extra: CSSProperties = {}): CSSProperties {
  return { ...(variables as CSSProperties), ...extra };
}

/** The document part, shared by the app view and Zen mode. */
function DocumentSample() {
  const { t } = useTranslation();
  return (
    <>
      <div className="theme-preview__heading">{t("themeBuilder.preview.heading")}</div>
      <p className="theme-preview__text">
        {t("themeBuilder.preview.textBefore")}{" "}
        <span className="theme-preview__link">{t("themeBuilder.preview.link")}</span>{" "}
        <mark className="theme-preview__marker">{t("themeBuilder.preview.marker")}</mark>{" "}
        <span className="theme-preview__selection">{t("themeBuilder.preview.selection")}</span>{" "}
        <span className="theme-preview__search">{t("themeBuilder.preview.search")}</span>{" "}
        <span className="theme-preview__search is-current">{t("themeBuilder.preview.searchCurrent")}</span>
      </p>
      <div className="theme-preview__task">
        <span className="theme-preview__checkbox">
          <Check aria-hidden="true" />
        </span>
        <span>{t("themeBuilder.preview.task")}</span>
      </div>
      <div className="theme-preview__quote">{t("themeBuilder.preview.quote")}</div>
      <pre className="theme-preview__code">
        <span className="theme-preview__code-comment">{"// "}{t("themeBuilder.preview.codeComment")}</span>
        {"\n"}
        <span className="theme-preview__code-keyword">const</span>{" "}
        <span className="theme-preview__code-variable">dog</span>
        {" = "}
        <span className="theme-preview__code-function">fetch</span>
        {"("}
        <span className="theme-preview__code-string">"ball"</span>
        {", "}
        <span className="theme-preview__code-number">42</span>
        {"): "}
        <span className="theme-preview__code-type">Toy</span>
      </pre>
      <div className="theme-preview__review">
        <span className="theme-preview__diff-removed">{t("themeBuilder.preview.diffRemoved")}</span>{" "}
        <span className="theme-preview__diff-added">{t("themeBuilder.preview.diffAdded")}</span>
      </div>
    </>
  );
}

/**
 * An abstract, static piece of the app, fed by the theme being edited: the
 * derived custom properties go on the container as inline styles, and
 * everything inside reads them through var(). The preview is therefore right
 * by construction, and the app around it stays untouched while editing.
 * Every base colour and every derived tone shows up somewhere; hover and
 * active are drawn as fixed states.
 */
export function ThemePreview({ theme, view, withWorkingSet = false }: ThemePreviewProps) {
  const { t } = useTranslation();
  const resolved = useMemo(() => resolveTheme(theme), [theme]);
  const onPaper = view === "paper" && resolved.paper !== null;

  // Zen mode: the bare text column on the page. Without a Zen page of its
  // own the theme's window shows through, as in the app.
  if (view === "zen") {
    const zen = resolved.zen;
    const style = zen
      ? asStyle(
          { ...resolved.root, ...zen.palette, ...zen.prose },
          { colorScheme: zen.mode, background: zen.background }
        )
      : asStyle({ ...resolved.root, ...resolved.prose }, { colorScheme: theme.mode });
    return (
      <div
        className="theme-preview theme-preview--zen"
        data-mode={zen?.mode ?? theme.mode}
        style={style}
        aria-label={t("themeBuilder.previewLabel")}
        role="img"
      >
        <span className="theme-preview__zen-exit">
          <X aria-hidden="true" />
        </span>
        <span className="theme-preview__zen-dirty" />
        <div className="theme-preview__zen-column">
          <DocumentSample />
        </div>
      </div>
    );
  }

  const editorStyle = onPaper && resolved.paper
    ? asStyle({ ...resolved.paper.palette, ...resolved.paper.prose }, { colorScheme: "light" })
    : undefined;

  return (
    <div
      className="theme-preview"
      data-mode={theme.mode}
      style={asStyle({ ...resolved.root, ...resolved.prose }, { colorScheme: theme.mode })}
      aria-label={t("themeBuilder.previewLabel")}
      role="img"
    >
      <div className="theme-preview__window">
        <aside className="theme-preview__sidebar">
          {/* The open note shows in both lists at once, so once they are
              styled apart this is the only place the two marks can be
              compared: the same note, twice, one above the other. */}
          {withWorkingSet ? (
            <>
              <div className="theme-preview__sidebar-title">{t("themeBuilder.preview.workingSet")}</div>
              <div className="theme-preview__row theme-preview__row--open is-active">
                <span>{t("themeBuilder.preview.fileActive")}</span>
                <span className="theme-preview__dirty" />
              </div>
              <div className="theme-preview__row theme-preview__row--open">
                <span>{t("themeBuilder.preview.fileHover")}</span>
              </div>
            </>
          ) : null}
          <div className="theme-preview__sidebar-title">{t("themeBuilder.preview.vault")}</div>
          <div className="theme-preview__row">
            <Folder aria-hidden="true" />
            <span>{t("themeBuilder.preview.folder")}</span>
          </div>
          <div className="theme-preview__row theme-preview__row--nested is-hover">
            <FileText aria-hidden="true" />
            <span>{t("themeBuilder.preview.fileHover")}</span>
          </div>
          <div className="theme-preview__row theme-preview__row--nested is-active">
            <FileText aria-hidden="true" />
            <span>{t("themeBuilder.preview.fileActive")}</span>
            <span className="theme-preview__dirty" />
          </div>
          <div className="theme-preview__row theme-preview__row--nested is-search-match">
            <FileText aria-hidden="true" />
            <span>{t("themeBuilder.preview.fileMatch")}</span>
            <span className="theme-preview__badge">3</span>
          </div>
          <div className="theme-preview__row">
            <FileText aria-hidden="true" />
            <span className="theme-preview__muted">{t("themeBuilder.preview.fileMuted")}</span>
          </div>
          <div className="theme-preview__scrollbar" />
        </aside>

        <section className="theme-preview__main">
          <div className="theme-preview__toolbar">
            <span className="theme-preview__tool is-active">
              <Bold aria-hidden="true" />
            </span>
            <span className="theme-preview__tool is-hover">
              <Italic aria-hidden="true" />
            </span>
            <span className="theme-preview__tool-separator" />
            <span className="theme-preview__ai-button">
              <Sparkles aria-hidden="true" />
              {t("themeBuilder.preview.aiButton")}
            </span>
          </div>

          <div
            className={`theme-preview__editor${onPaper ? " theme-preview__editor--paper" : ""}`}
            style={editorStyle}
          >
            <DocumentSample />
          </div>

          <div className="theme-preview__chips">
            <span className="theme-preview__chip theme-preview__chip--error">{t("themeBuilder.preview.chipError")}</span>
            <span className="theme-preview__chip theme-preview__chip--success">{t("themeBuilder.preview.chipSuccess")}</span>
            <span className="theme-preview__chip theme-preview__chip--warning">{t("themeBuilder.preview.chipWarning")}</span>
            <span className="theme-preview__chip theme-preview__chip--info">{t("themeBuilder.preview.chipInfo")}</span>
          </div>
        </section>
      </div>

      <div className="theme-preview__overlay">
        <div className="theme-preview__dialog">
          <div className="theme-preview__dialog-title">{t("themeBuilder.preview.dialogTitle")}</div>
          <div className="theme-preview__dialog-text">{t("themeBuilder.preview.dialogText")}</div>
          <div className="theme-preview__dialog-actions">
            <span className="theme-preview__button theme-preview__button--outline">
              {t("themeBuilder.preview.cancel")}
            </span>
            <span className="theme-preview__button theme-preview__button--primary">{t("themeBuilder.preview.ok")}</span>
          </div>
        </div>
        <div className="theme-preview__toast">{t("themeBuilder.preview.toast")}</div>
      </div>
    </div>
  );
}
