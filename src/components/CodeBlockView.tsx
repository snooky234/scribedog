import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Check, ChevronDown, Copy } from "lucide-react";

import {
  Menu,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger
} from "@/components/ui/menu";
import { CODE_LANGUAGES } from "@/lib/codeLanguages";
import { isMermaidLanguage } from "@/lib/diagrams/mermaidBlocks";
import { currentMermaidMode, mermaidErrorMessage, renderMermaidSvg, type MermaidRenderMode } from "@/lib/diagrams/mermaidRenderer";

const PLAIN_VALUE = "";
// Long enough that typing a diagram does not re-layout it on every key.
const RENDER_DELAY_MS = 250;

type DiagramState = { svg: string; error: null } | { svg: null; error: string } | null;

function useMermaidMode(): MermaidRenderMode {
  const [mode, setMode] = useState(currentMermaidMode);

  useEffect(() => {
    const observer = new MutationObserver(() => setMode(currentMermaidMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return mode;
}

function useMermaidDiagram(source: string, enabled: boolean): DiagramState {
  const mode = useMermaidMode();
  const [state, setState] = useState<DiagramState>(null);

  useEffect(() => {
    if (!enabled || !source.trim()) {
      setState(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      renderMermaidSvg(source, mode).then(
        (svg) => !cancelled && setState({ svg, error: null }),
        (error: unknown) => !cancelled && setState({ svg: null, error: mermaidErrorMessage(error) })
      );
    }, RENDER_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, enabled, mode]);

  return state;
}

export function CodeBlockView({ node, updateAttributes, selected, editor, getPos }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const language = ((node.attrs.language as string | null) ?? "").trim();
  const isDiagram = isMermaidLanguage(language);
  const diagram = useMermaidDiagram(node.textContent, isDiagram);
  // Outside the block only the drawing shows; with the caret inside, the
  // source comes back with the drawing below it as a live preview. A locked
  // editor (staged review) keeps the source visible, since that is where the
  // red/green diff is drawn. A broken diagram keeps its source visible too.
  const sourceHidden = isDiagram && !selected && editor.isEditable && Boolean(diagram?.svg);

  const focusSource = (event: MouseEvent) => {
    const position = getPos();

    if (!editor.isEditable || typeof position !== "number") {
      return;
    }

    event.preventDefault();
    editor.chain().focus().setTextSelection(position + 1).run();
  };
  const known = CODE_LANGUAGES.find((entry) => entry.value === language);
  // A fence language outside the curated set (```haskell) stays selectable so
  // switching away from it is possible without losing the fence info first.
  const label = known?.label ?? (language || t("codeBlock.plain"));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. missing permission)
    }
  };

  return (
    <NodeViewWrapper
      className={sourceHidden ? "code-block-wrapper code-block-wrapper--diagram-only" : "code-block-wrapper"}
    >
      {/* Two small badges on the block's top edge instead of a button bar
          overlaying the first line: the content area stays free. The
          language badge opens the switch menu; it is the trigger, never the
          block itself, so a click into the code still only places the
          caret. Copy sits next to it as its own one-click button. */}
      <div
        className={
          selected || copied ? "code-block-wrapper__badge code-block-wrapper__badge--visible" : "code-block-wrapper__badge"
        }
        contentEditable={false}
      >
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                className="code-block-wrapper__badge-button"
                aria-label={t("codeBlock.language")}
                title={t("codeBlock.language")}
              >
                {label}
                <ChevronDown size={12} aria-hidden="true" />
              </button>
            }
          />
          <MenuPortal>
            <MenuPositioner align="end">
              <MenuPopup className="max-h-72 overflow-y-auto">
                <MenuRadioGroup
                  value={language}
                  onValueChange={(value) =>
                    updateAttributes({ language: value === PLAIN_VALUE ? null : (value as string) })
                  }
                >
                  <MenuRadioItem value={PLAIN_VALUE}>
                    {t("codeBlock.plain")}
                    <MenuRadioItemIndicator />
                  </MenuRadioItem>
                  {!known && language ? (
                    <MenuRadioItem value={language}>
                      {language}
                      <MenuRadioItemIndicator />
                    </MenuRadioItem>
                  ) : null}
                  {CODE_LANGUAGES.map((entry) => (
                    <MenuRadioItem key={entry.value} value={entry.value}>
                      {entry.label}
                      <MenuRadioItemIndicator />
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </MenuPositioner>
          </MenuPortal>
        </Menu>
        <button
          type="button"
          className="code-block-wrapper__badge-button"
          onClick={handleCopy}
          aria-label={t("codeBlock.copy")}
          title={t("codeBlock.copy")}
        >
          {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        </button>
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
      {isDiagram && diagram?.svg ? (
        <div
          className="mermaid-diagram"
          contentEditable={false}
          title={editor.isEditable && sourceHidden ? t("codeBlock.editDiagram") : undefined}
          onMouseDown={sourceHidden ? focusSource : undefined}
          // Mermaid's own output under securityLevel "strict", already run
          // through its DOMPurify pass.
          dangerouslySetInnerHTML={{ __html: diagram.svg }}
        />
      ) : null}
      {isDiagram && diagram?.error ? (
        <div className="mermaid-diagram__error" contentEditable={false} role="status">
          <strong>{t("codeBlock.diagramError")}</strong>
          <pre>{diagram.error}</pre>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
