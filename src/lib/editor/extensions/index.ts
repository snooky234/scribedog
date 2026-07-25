import { Link } from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import type { Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { AiDiffWidget } from "@/lib/aiDiffWidget";
import { AiStreamWidget } from "@/lib/aiStreamWidget";
import { AiSuggestionWidget } from "@/lib/aiSuggestionWidget";
import { InactiveSelection } from "@/lib/inactiveSelection";
import { SearchHighlight } from "@/lib/searchHighlight";
import { VoiceInsertWidget } from "@/lib/voiceInsertWidget";

import { Callout } from "./callout";
import { CodeBlock } from "./codeBlock";
import { EditorImage } from "./image";
import { TaskList, TaskListMarkdown } from "./taskList";
import { Underline } from "./underline";

// Everything that defines the document model itself, in the order TipTap loads
// them — shared with the read-only AI preview so a proposal renders there
// exactly as it will look once accepted.
function buildContentExtensions(): Extensions {
  return [
    StarterKit.configure({ codeBlock: false }),
    CodeBlock,
    Callout,
    TaskList,
    TaskItem.configure({ nested: true }),
    TaskListMarkdown,
    Underline,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Link.configure({
      autolink: false,
      linkOnPaste: false,
      openOnClick: false
    }),
    Markdown.configure({
      html: false,
      breaks: true
    })
  ];
}

// The complete extension set of the editor. The widgets at the end (AI
// stream/diff/suggestion, voice insert, search highlight, inactive selection)
// are decoration-only and don't affect serialization. EditorImage lives here
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
    InactiveSelection
  ];
}

// Extension set of the AI proposal preview (AiDiffResultView). Without the
// table and callout nodes in this schema, a proposed table renders there as
// literal pipe text no matter how well-formed its Markdown is.
export function buildPreviewExtensions(): Extensions {
  return buildContentExtensions();
}
