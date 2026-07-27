import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  folderCheckState,
  type RagFolderNode,
  type RagFolderSelection
} from "@/lib/ragConfig";

// Deliberately not built on src/components/fileTree/TreeNodeRow.tsx. That row
// carries file entries, drag sorting, rename/delete context menus and vault
// navigation — none of which this picker wants, and pulling its concerns in
// here would make both components worse. What the two share is a look, and that
// lives in CSS.

type RagFolderTreeProps = {
  root: RagFolderNode;
  selection: RagFolderSelection;
  disabled: boolean;
  onToggle: (folderPath: string, included: boolean) => void;
};

type RowProps = RagFolderTreeProps & {
  node: RagFolderNode;
  depth: number;
  label: string;
  expandedPaths: Set<string>;
  onToggleExpanded: (path: string) => void;
};

/** Markdown files in this folder and everything below it. */
function totalFileCount(node: RagFolderNode): number {
  return node.fileCount + node.children.reduce((sum, child) => sum + totalFileCount(child), 0);
}

function FolderRow({
  node,
  depth,
  label,
  selection,
  disabled,
  expandedPaths,
  onToggle,
  onToggleExpanded,
  root
}: RowProps) {
  const state = folderCheckState(selection, node.path);
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedPaths.has(node.path);
  const fileCount = totalFileCount(node);

  return (
    <li>
      <div className="rag-tree__row" style={{ paddingLeft: `${depth * 1.1}rem` }}>
        {hasChildren ? (
          <button
            type="button"
            className="rag-tree__twisty"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? undefined : label}
            onClick={() => onToggleExpanded(node.path)}
          >
            {isExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        ) : (
          <span className="rag-tree__twisty rag-tree__twisty--empty" aria-hidden="true" />
        )}

        <label className="rag-tree__label">
          <input
            type="checkbox"
            checked={state === "checked"}
            disabled={disabled}
            // "mixed" is a real ARIA checkbox state, but the DOM only exposes
            // it through the indeterminate property — which has no attribute,
            // so it has to be set on the node itself.
            ref={(input) => {
              if (input) {
                input.indeterminate = state === "mixed";
              }
            }}
            aria-checked={state === "mixed" ? "mixed" : state === "checked"}
            onChange={(event) => onToggle(node.path, event.target.checked)}
          />
          {isExpanded && hasChildren ? (
            <FolderOpen className="rag-tree__icon" aria-hidden="true" />
          ) : (
            <Folder className="rag-tree__icon" aria-hidden="true" />
          )}
          <span className="rag-tree__name">{label}</span>
          <span className="rag-tree__count">{fileCount}</span>
        </label>
      </div>

      {hasChildren && isExpanded ? (
        <ul className="rag-tree__children">
          {node.children.map((child) => (
            <FolderRow
              key={child.path}
              root={root}
              node={child}
              depth={depth + 1}
              label={child.name}
              selection={selection}
              disabled={disabled}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The folder picker of the knowledge base tab: one checkbox per folder, with a
 * mixed state for a folder whose subfolders disagree.
 *
 * Only folders containing markdown files (directly or further down) appear —
 * see buildRagFolderTree. There is nothing for the knowledge base to read
 * anywhere else, and empty folders would only make the tree harder to scan.
 */
export function RagFolderTree({ root, selection, disabled, onToggle }: RagFolderTreeProps) {
  const { t } = useTranslation();
  // First level open on mount: the user has to see something to tick without
  // hunting, and everything open at once is unreadable in a deep vault.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(["", ...root.children.map((child) => child.path)])
  );

  const handleToggleExpanded = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);

      if (!next.delete(path)) {
        next.add(path);
      }

      return next;
    });
  };

  if (root.children.length === 0 && root.fileCount === 0) {
    return <p className="rag-settings__hint">{t("ragSettings.emptyVault")}</p>;
  }

  return (
    <ul className="rag-tree" role="tree" aria-label={t("ragSettings.foldersLabel")}>
      <FolderRow
        root={root}
        node={root}
        depth={0}
        label={t("ragSettings.vaultRoot")}
        selection={selection}
        disabled={disabled}
        expandedPaths={expandedPaths}
        onToggle={onToggle}
        onToggleExpanded={handleToggleExpanded}
      />
    </ul>
  );
}
