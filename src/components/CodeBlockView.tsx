import { useState } from "react";
import { useTranslation } from "react-i18next";

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Check, Copy } from "lucide-react";

export function CodeBlockView({ node }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

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
    <NodeViewWrapper className="code-block-wrapper">
      <button
        type="button"
        className="code-block-wrapper__copy"
        contentEditable={false}
        onClick={handleCopy}
        aria-label={t("codeBlock.copy")}
        title={t("codeBlock.copy")}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
