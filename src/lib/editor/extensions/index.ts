import { Link } from "@tiptap/extension-link";
import type { Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { AiDiffWidget } from "@/lib/aiDiffWidget";
import { AiStreamWidget } from "@/lib/aiStreamWidget";
import { AiSuggestionWidget } from "@/lib/aiSuggestionWidget";
import { CodeBlockLinks } from "@/lib/editor/codeBlockLinks";
import { HeadingNumbering } from "@/lib/editor/headingNumbering";
import { InactiveSelection } from "@/lib/inactiveSelection";
import { OutlineHighlight } from "@/lib/editor/outlineHighlight";
import { TableGrips } from "@/lib/editor/tableGrips";
import { SearchHighlight } from "@/lib/searchHighlight";
import { VoiceInsertWidget } from "@/lib/voiceInsertWidget";

import { Callout } from "./callout";
import { CodeBlock } from "./codeBlock";
import { Highlight } from "./highlight";
import { EditorImage } from "./image";
import { ListBackspace } from "./listBackspace";
import { HardBreak, Table, TableCell, TableHeader, TableRow } from "./table";
import { TaskItem, TaskList, TaskListMarkdown } from "./taskList";
import { Underline } from "./underline";

// Everything that defines the document model itself, in the order TipTap loads
// them — shared with the read-only AI preview so a proposal renders there
// exactly as it will look once accepted.
function buildContentExtensions(): Extensions {
  return [
    // The hard break and the table are the local variants: they serialize a
    // cell (lists included) without ever falling back to tiptap-markdown's
    // "[table]" placeholder, and read its lists back (table.ts).
    // StarterKit 3 brings its own Link and Underline. Left on, its Link keeps
    // openOnClick and opens every link in a new browser tab next to the
    // editor's own click handling (in the desktop webview that window.open
    // goes nowhere, in the browser it opens a note's relative path as a URL).
    StarterKit.configure({
      codeBlock: false,
      hardBreak: false,
      link: false,
      underline: false
    }),
    CodeBlock,
    ListBackspace,
    HardBreak,
    Callout,
    TaskList,
    TaskItem.configure({ nested: true }),
    TaskListMarkdown,
    Underline,
    Highlight,
    // A table can be selected as a whole (the grip in its corner,
    // tableGrips.ts); without this prosemirror-tables turns that selection
    // into a selection of every cell, which Alt+Shift+Up/Down would read
    // as "move the row".
    Table.configure({ resizable: true, allowTableNodeSelection: true }),
    TableRow,
    TableHeader,
    TableCell,
    Link.configure({
      autolink: false,
      linkOnPaste: false,
      openOnClick: false
    }),
    // html: false — raw HTML in a note stays visible text instead of being
    // parsed into the document; the price is the placeholder fallback the
    // table serializer works around.
    Markdown.configure({
      html: false,
      breaks: true
    })
  ];
}

// The complete extension set of the editor. The widgets at the end (AI
// stream/diff/suggestion, voice insert, search highlight, code block links,
// table grips, inactive selection) are decoration-only and don't affect serialization. EditorImage lives here
// rather than in the content set: its NodeView resolves vault-relative paths
// into blob URLs, which only makes sense for a document that is actually open.
export function buildEditorExtensions(): Extensions {
  return [
    ...buildContentExtensions(),
    EditorImage,
    AiStreamWidget,
    VoiceInsertWidget,
    AiDiffWidget,
    AiSuggestionWidget,
    SearchHighlight,
    CodeBlockLinks,
    OutlineHighlight,
    HeadingNumbering,
    TableGrips,
    InactiveSelection
  ];
}

// Extension set of the AI proposal preview (AiDiffResultView). Without the
// table and callout nodes in this schema, a proposed table renders there as
// literal pipe text no matter how well-formed its Markdown is.
export function buildPreviewExtensions(): Extensions {
  return buildContentExtensions();
}
