import { Link } from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import type { Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { AiDiffWidget } from "@/lib/aiDiffWidget";
import { AiStreamWidget } from "@/lib/aiStreamWidget";
import { SearchHighlight } from "@/lib/searchHighlight";
import { VoiceInsertWidget } from "@/lib/voiceInsertWidget";

import { CodeBlock } from "./codeBlock";
import { EditorImage } from "./image";
import { TaskList } from "./taskList";
import { Underline } from "./underline";

// The complete extension set of the editor, in the order TipTap loads them.
// The four ProseMirror widgets at the end (AI stream/diff, voice insert,
// search highlight) are decoration-only and don't affect serialization.
export function buildEditorExtensions(): Extensions {
  return [
    StarterKit.configure({ codeBlock: false }),
    CodeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    EditorImage,
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
    }),
    AiStreamWidget,
    VoiceInsertWidget,
    AiDiffWidget,
    SearchHighlight
  ];
}
