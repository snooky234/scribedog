import MarkdownIt from "markdown-it";

// Renderer for assistant chat bubbles: LLM answers arrive as Markdown, so the
// panel would otherwise show raw "**bold**" / "- list" control characters.
// html:false escapes any raw HTML the model emits (it can't inject markup),
// linkify turns bare URLs into links, and breaks maps single newlines to <br>
// so chat-style line breaks survive without needing a blank line between them.
const markdownIt = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function renderChatMarkdown(source: string): string {
  return markdownIt.render(source);
}
