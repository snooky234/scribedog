import type { ExportBlock, InlineRun } from "./markdownModel";
import type { ExportImageMap } from "./imageAssets";

// Standalone HTML export: one self-contained file, styles inlined, local
// images embedded as data URIs (the exported file must work without the
// vault next to it).

const DOCUMENT_CSS = `
  :root { color-scheme: light; }
  body {
    margin: 0 auto;
    padding: 3rem 2.5rem 4rem;
    max-width: 46rem;
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 16px;
    line-height: 1.65;
    color: #1f2328;
    background: #ffffff;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.6em; }
  h1 { font-size: 2em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
  h3 { font-size: 1.25em; }
  p { margin: 0.75em 0; }
  a { color: #0969da; }
  img { max-width: 100%; height: auto; }
  code {
    font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace;
    font-size: 0.9em;
    background: #f0f2f5;
    border-radius: 4px;
    padding: 0.15em 0.35em;
  }
  pre {
    background: #f6f8fa;
    border: 1px solid #d1d9e0;
    border-radius: 6px;
    padding: 0.9em 1.1em;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; font-size: 0.875em; }
  blockquote {
    margin: 0.75em 0;
    padding: 0.1em 1em;
    border-left: 0.25em solid #d1d9e0;
    color: #59636e;
  }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #d1d9e0; padding: 0.4em 0.8em; }
  th { background: #f6f8fa; }
  hr { border: none; border-top: 1px solid #d1d9e0; margin: 2em 0; }
  ul.task-list { list-style: none; padding-left: 1.2em; }
  ul.task-list input { margin-right: 0.45em; }
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderRuns(runs: InlineRun[], images: ExportImageMap): string {
  let html = "";

  for (const run of runs) {
    if (run.kind === "break") {
      html += "<br />";
      continue;
    }

    if (run.kind === "image") {
      const asset = images.get(run.src);

      if (asset) {
        const widthAttr = run.width ? ` width="${run.width}"` : "";
        html += `<img src="${asset.originalDataUrl}" alt="${escapeHtml(run.alt)}"${widthAttr} />`;
      } else if (run.alt) {
        html += `<em>${escapeHtml(run.alt)}</em>`;
      }

      continue;
    }

    let text = escapeHtml(run.text);

    if (run.code) {
      text = `<code>${text}</code>`;
    }
    if (run.bold) {
      text = `<strong>${text}</strong>`;
    }
    if (run.italic) {
      text = `<em>${text}</em>`;
    }
    if (run.underline) {
      text = `<u>${text}</u>`;
    }
    if (run.strike) {
      text = `<s>${text}</s>`;
    }
    if (run.link) {
      text = `<a href="${escapeHtml(run.link)}">${text}</a>`;
    }

    html += text;
  }

  return html;
}

function renderBlocks(blocks: ExportBlock[], images: ExportImageMap): string {
  let html = "";

  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const level = Math.min(Math.max(block.level, 1), 6);
        html += `<h${level}>${renderRuns(block.runs, images)}</h${level}>\n`;
        break;
      }
      case "paragraph":
        html += `<p>${renderRuns(block.runs, images)}</p>\n`;
        break;
      case "codeBlock":
        html += `<pre><code>${escapeHtml(block.text)}</code></pre>\n`;
        break;
      case "blockquote":
        html += `<blockquote>\n${renderBlocks(block.children, images)}</blockquote>\n`;
        break;
      case "list": {
        const isTaskList = block.items.some((item) => item.checked !== null);
        const tag = block.ordered ? "ol" : "ul";
        const attrs = [
          block.ordered && block.start !== 1 ? ` start="${block.start}"` : "",
          !block.ordered && isTaskList ? ' class="task-list"' : ""
        ].join("");

        html += `<${tag}${attrs}>\n`;

        for (const item of block.items) {
          const checkbox =
            item.checked === null
              ? ""
              : `<input type="checkbox" disabled${item.checked ? " checked" : ""} /> `;

          // Render a leading paragraph inline (no <p>), otherwise the block
          // element forces a line break right after the checkbox/bullet.
          const [first, ...rest] = item.children;
          const inlineFirst =
            first?.kind === "paragraph" ? renderRuns(first.runs, images) : "";
          const remaining = first?.kind === "paragraph" ? rest : item.children;

          html += `<li>${checkbox}${inlineFirst}${renderBlocks(remaining, images)}</li>\n`;
        }

        html += `</${tag}>\n`;
        break;
      }
      case "table": {
        html += "<table>\n";

        for (const row of block.rows) {
          html += "<tr>";

          for (const cell of row) {
            const tag = cell.header ? "th" : "td";
            const alignAttr = cell.align !== "left" ? ` style="text-align:${cell.align}"` : "";
            html += `<${tag}${alignAttr}>${renderRuns(cell.runs, images)}</${tag}>`;
          }

          html += "</tr>\n";
        }

        html += "</table>\n";
        break;
      }
      case "hr":
        html += "<hr />\n";
        break;
    }
  }

  return html;
}

// Body-only variant for consumers that place the rendered blocks inside an
// existing document (the in-app print flow) instead of a standalone file.
export function renderHtmlBody(blocks: ExportBlock[], images: ExportImageMap): string {
  return renderBlocks(blocks, images);
}

export function renderHtmlDocument(
  title: string,
  blocks: ExportBlock[],
  images: ExportImageMap
): string {
  return [
    "<!doctype html>",
    '<html lang="">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${DOCUMENT_CSS}</style>`,
    "</head>",
    "<body>",
    renderBlocks(blocks, images),
    "</body>",
    "</html>",
    ""
  ].join("\n");
}
