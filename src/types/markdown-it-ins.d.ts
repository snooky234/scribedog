declare module "markdown-it-ins" {
  import type MarkdownIt from "markdown-it";

  const insPlugin: (md: MarkdownIt) => void;
  export default insPlugin;
}
