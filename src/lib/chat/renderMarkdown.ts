import MarkdownIt from "markdown-it";

// Renderer for assistant chat bubbles: LLM answers arrive as Markdown, so the
// panel would otherwise show raw "**bold**" / "- list" control characters.
// html:false escapes any raw HTML the model emits (it can't inject markup),
// linkify turns bare URLs into links, and breaks maps single newlines to <br>
// so chat-style line breaks survive without needing a blank line between them.
const markdownIt = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Only links that carry their own scheme get linkified. Bare "domains" are a
// trap here: an answer mentioning a note as `Ideas/Craft Ideas.md` breaks at
// the space, leaving `Ideas.md` — a syntactically valid domain, since .md is
// Moldova's TLD — so a file reference silently turned into a link to a
// stranger's website.
markdownIt.linkify.set({ fuzzyLink: false });

export function renderChatMarkdown(source: string): string {
  return markdownIt.render(source);
}
