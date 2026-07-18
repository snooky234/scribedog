import TurndownService from "turndown";
// @ts-expect-error turndown-plugin-gfm ships no type declarations.
import { gfm } from "turndown-plugin-gfm";

// Shared Turndown setup for all document importers. The gfm plugin adds
// tables and strikethrough, matching what the editor can render.
export function createHtmlToMarkdownConverter(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*"
  });

  turndown.use(gfm);

  return turndown;
}

// The gfm table rule only converts tables whose first row is a heading row.
// DOCX tables come out of mammoth as plain <td> rows, so the first row is
// promoted to a <thead> with <th> cells here.
function normalizeTablesForGfm(html: string): string {
  const parsedDocument = new DOMParser().parseFromString(html, "text/html");

  for (const table of Array.from(parsedDocument.querySelectorAll("table"))) {
    // Pipe tables cannot hold block elements: unwrap the paragraphs mammoth
    // puts into every cell, joining multiple paragraphs with <br>.
    for (const cell of Array.from(table.querySelectorAll("td, th"))) {
      const paragraphs = Array.from(cell.querySelectorAll("p"));

      for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
        if (paragraphIndex > 0) {
          paragraph.before(parsedDocument.createElement("br"));
        }

        paragraph.replaceWith(...Array.from(paragraph.childNodes));
      }
    }

    if (table.querySelector("th")) {
      continue;
    }

    const firstRow = table.querySelector("tr");

    if (!firstRow) {
      continue;
    }

    for (const cell of Array.from(firstRow.querySelectorAll("td"))) {
      const headerCell = parsedDocument.createElement("th");
      headerCell.innerHTML = cell.innerHTML;
      cell.replaceWith(headerCell);
    }

    const head = parsedDocument.createElement("thead");
    head.appendChild(firstRow);
    table.insertBefore(head, table.firstChild);
  }

  return parsedDocument.body.innerHTML;
}

export function convertHtmlToMarkdown(html: string): string {
  return createHtmlToMarkdownConverter().turndown(normalizeTablesForGfm(html)).trim();
}
