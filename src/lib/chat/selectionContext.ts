// Carries the passage the user had selected in the editor into the turn the
// model sees.
//
// Same two-stage split as the image attachments next door: the stored history
// keeps the selection in its own field on the user turn (so the transcript can
// show what a question referred to, and the passage stays out of the user's own
// words), and it is expanded into the message content only in the derived view
// that goes out with a request.

import type { AiChatMessage } from "@/lib/aiClient";

// Hard cap on how much selected text one turn carries. A user can select a
// whole document, and charging that against the context window — plus writing
// it into chat-sessions.json on top — is a poor trade for a passage the agent
// can always re-read with get_selection.
export const MAX_SELECTION_CHARS = 4000;

export function clampSelection(selection: string): string {
  const trimmed = selection.trim();

  return trimmed.length > MAX_SELECTION_CHARS ? trimmed.slice(0, MAX_SELECTION_CHARS) : trimmed;
}

// Model-facing English, like the tool results in agentTools.ts — the user never
// sees this text, only the localized selection chip in the composer.
function buildSelectionNote(selection: string): string {
  const lines = [
    "[Document context: the user has selected the following passage in the editor, and the message " +
      "below refers to it. It is given as Markdown, exactly as it stands in the document.",
    "--- selected passage ---",
    selection,
    "--- end of selected passage ---"
  ];

  if (selection.length >= MAX_SELECTION_CHARS) {
    lines.push("The passage is cut off here — call get_selection when you need all of it.");
  }

  lines.push(
    "This is the passage's current wording, so a request aimed only at it needs neither get_document " +
      "nor get_selection; read the rest of the document only when you genuinely need the surrounding " +
      "context. Propose a change to the passage with replace_selection, keeping the passage's " +
      "Markdown formatting and giving anything you add the same markers.]"
  );

  return lines.join("\n");
}

/**
 * Derived view of the history with the selection expanded into the content.
 *
 * Only the newest turn carrying a selection is expanded: that is the turn the
 * model is answering, and repeating every earlier selection verbatim would
 * spend the context window on passages the conversation has long moved past.
 * Runs before the window is trimmed (see selectMessagesForModel) so the note is
 * charged against the budget like any other content.
 */
export function inlineSelectionContext(messages: AiChatMessage[]): AiChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];

    if (message.role !== "user" || !message.selection) {
      continue;
    }

    const expanded = [...messages];
    expanded[i] = {
      ...message,
      content: `${buildSelectionNote(message.selection)}\n\n${message.content}`
    };

    return expanded;
  }

  return messages;
}
