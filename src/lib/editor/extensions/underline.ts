import BaseUnderline from "@tiptap/extension-underline";
import type MarkdownIt from "markdown-it";
import insPlugin from "markdown-it-ins";

// CommonMark has no underline syntax. We serialize it as "++text++" (the
// markdown-it-ins plugin's syntax for <ins>) and remap the resulting tag to
// <u> when parsing, so it maps back to this mark.
export const Underline = BaseUnderline.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: "++", close: "++", expelEnclosingWhitespace: true },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(insPlugin);
            markdownit.renderer.rules.ins_open = () => "<u>";
            markdownit.renderer.rules.ins_close = () => "</u>";
          }
        }
      }
    };
  }
});
