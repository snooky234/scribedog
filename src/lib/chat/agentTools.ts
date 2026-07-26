// Bridges the chat agent loop (src/store/useChatStore.ts) to the live editor
// instance. The store cannot reach into the editor component directly (the
// editor lives behind editorHandleRef in src/App.tsx), so App registers this
// module-wide bridge the same way activeAbortController is kept outside the
// store — a non-serializable value that would otherwise force awkward prop
// drilling through components that have nothing to do with the chat.

import { EDITING_TOOL_NAMES, FLAG_SUGGESTION_TOOL_NAME } from "@/lib/aiClient";
import { normalizeImageSrc, resolveDocumentImagePath } from "@/lib/chat/imageAttachments";
import { normalizeEscapedCheckboxes } from "@/lib/editor/markdownNormalize";

// What set_image_width did, so the tool result can name the resulting size.
// width === null means the image was reset to its natural size.
export type ImageWidthChange = {
  src: string;
  width: number | null;
  previousWidth: number | null;
};

/**
 * What came of a proposal. Everything but "proposed" is a mistake the model
 * can correct on its own — which only works if the tool result says *which*
 * one it was, rather than a single "could not propose" for all of them.
 */
export type ProposalOutcome =
  | "proposed"
  // The identical text is already sitting in the editor waiting for review.
  | "duplicate"
  // The proposal embeds an image the document already carries.
  | "image-duplicate"
  // insert_at_cursor's after_text names nothing in this document.
  | "anchor-not-found"
  // replace_passage's old_text names nothing in this document.
  | "not-found"
  | "failed";

export type EditorToolBridge = {
  getDocument: () => string;
  getSelection: () => string;
  // The src of every image embedded in the current document, in document
  // order. Backs get_image's allowlist check below.
  listImageSources: () => string[];
  // Short previews of the proposals currently waiting for review. They are not
  // part of the document yet, which get_document has to say out loud — see
  // pendingProposalNote below.
  listPendingProposals: () => string[];
  // Applies / drops every proposal still waiting for review and answers with
  // how many that was — what the accept_proposals and discard_proposals tools
  // do when the user settles the review from the chat instead of clicking the
  // widgets.
  acceptPendingProposals: () => number;
  discardPendingProposals: () => number;
  // The three editing tools don't change the document — they open a red/green
  // proposal in the editor that the user accepts or discards (see
  // src/lib/aiSuggestionWidget.ts).
  proposeSelectionReplacement: (text: string) => ProposalOutcome;
  // anchorText: a passage the insertion should follow, or an image path. Empty
  // means "at the user's cursor".
  proposeInsertion: (text: string, anchorText?: string) => ProposalOutcome;
  proposePassageReplacement: (oldText: string, newText: string) => ProposalOutcome;
  // The one tool that edits the document directly rather than proposing:
  // an image's width is a node attribute, not text — there is no wording to
  // review, and the red/green preview cannot even render the image (its
  // NodeView resolves vault paths from a React context the widget's own root
  // doesn't sit in). The new size is visible in the document immediately and
  // Ctrl+Z takes it back, which is the review.
  setImageWidth: (src: string, request: { width?: number; scale?: number }) => ImageWidthChange | null;
};

let bridge: EditorToolBridge | null = null;

export function registerEditorToolBridge(next: EditorToolBridge | null): void {
  bridge = next;
  // A new editor means a new document, and the proposals of the old one are
  // gone with it — see carriedInProposals below.
  carriedInProposals = [];
}

// Proposals that were already waiting when the current user turn started —
// i.e. ones the user has neither accepted nor discarded. Set by beginChatTurn
// and cleared as soon as this turn settles them, because everything that turns
// on "unsettled review" has to ignore the proposals the turn makes itself:
// several proposals in one answer are normal and must not block each other.
let carriedInProposals: string[] = [];

/**
 * Snapshots the unsettled review at the start of a user turn, and answers with
 * the previews so the caller can put them in front of the model.
 *
 * Leaving proposals open across turns is what produced the broken transcripts:
 * they are not part of the document, so the model re-reads the document, finds
 * the passage it thought it had rewritten in its original wording, and either
 * proposes the same thing again (stacking a second widget on the same spot) or
 * searches for its own proposed text and gets "passage not found" over and
 * over. So a turn that starts with proposals open has to settle them first —
 * see pendingProposalTurnNote and the guard in executeTool.
 */
export function beginChatTurn(): string[] {
  carriedInProposals = bridge?.listPendingProposals() ?? [];

  return carriedInProposals;
}

/**
 * The note the chat store puts on the user's turn while a review from an
 * earlier turn is still open. Model-facing English like the tool results, and
 * derived fresh per request rather than stored in the history: it describes the
 * editor's current state, not something the user said.
 */
export function pendingProposalTurnNote(): string {
  if (carriedInProposals.length === 0) {
    return "";
  }

  return [
    `[Editor state: ${carriedInProposals.length} change(s) you proposed earlier are still waiting for the ` +
      "user's review and are NOT part of the document: " +
      `${carriedInProposals.map((preview) => `"${preview}"`).join(" / ")}.`,
    "Settle them before anything else. If the message below accepts them, call accept_proposals. If it " +
      "rejects them, call discard_proposals. If it asks for a different version of that same change, call " +
      "discard_proposals and then propose the new version. If it is about something else entirely, propose " +
      "nothing and do not discard anything: tell the user the proposals are still open and ask them to " +
      "accept or discard them first.]"
  ].join("\n");
}

/**
 * Refuses an editing tool while the previous turn's review is still open, so a
 * model that ignores the note above cannot pile a new proposal on top of the
 * old ones. Returns null once nothing is carried in — including as soon as this
 * turn has accepted or discarded them.
 */
function blockedByOpenReview(): string | null {
  if (carriedInProposals.length === 0) {
    return null;
  }

  // The user may have clicked accept/discard in the editor meanwhile, which is
  // the same settlement — nothing to refuse then.
  if ((bridge?.listPendingProposals() ?? []).length === 0) {
    carriedInProposals = [];
    return null;
  }

  return (
    `Error: ${carriedInProposals.length} earlier proposal(s) are still waiting for the user's review, so no ` +
    "new change can be proposed yet. If the user asked for a different version of that same change, call " +
    "discard_proposals first and then propose the new version. Otherwise propose nothing: tell the user the " +
    "proposals are still open and ask them to accept or discard them first."
  );
}

function settleProposals(accept: boolean): ToolResult {
  const count = accept ? (bridge?.acceptPendingProposals() ?? 0) : (bridge?.discardPendingProposals() ?? 0);

  carriedInProposals = [];

  if (count === 0) {
    return {
      content:
        "Error: there are no proposals waiting for review. Nothing was changed — just answer the user " +
        "normally."
    };
  }

  return {
    content: accept
      ? `OK: ${count} proposal(s) accepted and now part of the document. Confirm it in one short sentence.`
      : `OK: ${count} proposal(s) discarded. The document is unchanged. Confirm it in one short sentence.`
  };
}

// get_image cannot answer with the image itself (a tool result is text on every
// provider that isn't Anthropic), so it reports success and names the image it
// resolved; the store then appends it as a real image on a user turn. See
// sendMessage in src/store/useChatStore.ts.
export type ToolResult = { content: string; imagePath?: string };

/**
 * Resolves the path a model passed to get_image against the images actually
 * embedded in the open document.
 *
 * The allowlist is the security boundary, not a convenience: the path argument
 * originates from document text, which can come from anywhere, so accepting an
 * arbitrary path would turn get_image into "read any file this app can reach".
 * Only a src that really appears in the document is allowed through — and
 * resolveDocumentImagePath still confines it to the vault afterwards.
 */
function matchImageSource(sources: string[], rawPath: unknown): string | undefined {
  const requested = normalizeImageSrc(typeof rawPath === "string" ? rawPath : "");

  // A weak local model regularly calls a tool with no arguments at all. With a
  // single image in the document there is only one thing it could have meant,
  // so answer that instead of bouncing it into a retry loop.
  if (!requested) {
    return sources.length === 1 ? sources[0] : undefined;
  }

  return (
    sources.find((source) => normalizeImageSrc(source) === requested) ??
    // Models also like to shorten "images/photo.png" to "photo.png".
    sources.find((source) => {
      const normalized = normalizeImageSrc(source);
      return normalized.endsWith(`/${requested}`) || requested.endsWith(`/${normalized}`);
    })
  );
}

function unknownImageError(sources: string[]): string {
  return (
    "Error: that path is not an image in this document. Available images: " +
    `${sources.map((source) => normalizeImageSrc(source)).join(", ")}.`
  );
}

async function resolveImageArgument(rawPath: unknown): Promise<ToolResult> {
  const sources = bridge?.listImageSources() ?? [];

  if (sources.length === 0) {
    return { content: "Error: the document contains no images." };
  }

  const match = matchImageSource(sources, rawPath);

  if (!match) {
    return { content: unknownImageError(sources) };
  }

  if (!(await resolveDocumentImagePath(match))) {
    // Either the file is gone, or the src points outside the opened folder
    // (an absolute URL, or a path escaping the vault) — nothing to attach.
    return { content: "Error: that image cannot be read from disk." };
  }

  return {
    content: `OK: the image ${normalizeImageSrc(match)} is attached to the conversation. Describe what it shows.`,
    imagePath: normalizeImageSrc(match)
  };
}

/**
 * Reads a numeric tool argument. Models hand over "300", "300px" or even
 * "1,25" just as readily as a JSON number, and bouncing those into a retry
 * would be a worse answer than simply understanding them.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseFloat(value.replace(",", ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Turns the model's width/scale arguments into the bridge's request shape.
 * Returns null when neither argument says anything usable.
 *
 * A percentage is accepted wherever a model is likely to put one: "120%" as a
 * width means "20 % larger", and a scale above 10 can only ever have been meant
 * as a percentage — nobody asks for an image twenty times its size.
 */
function parseSizeArguments(rawWidth: unknown, rawScale: unknown): { width?: number; scale?: number } | null {
  const scale = toNumber(rawScale);

  if (typeof rawWidth === "string" && rawWidth.trim().endsWith("%")) {
    const percent = toNumber(rawWidth);
    return percent && percent > 0 ? { scale: percent / 100 } : null;
  }

  const width = toNumber(rawWidth);

  if (width !== null && width >= 0) {
    return { width: Math.round(width) };
  }

  if (scale !== null && scale > 0) {
    return { scale: scale > 10 ? scale / 100 : scale };
  }

  return null;
}

function resizeImage(args: Record<string, unknown>): ToolResult {
  const sources = bridge?.listImageSources() ?? [];

  if (sources.length === 0) {
    return { content: "Error: the document contains no images." };
  }

  const match = matchImageSource(sources, args.path);

  if (!match) {
    return { content: unknownImageError(sources) };
  }

  const request = parseSizeArguments(args.width, args.scale);

  if (!request) {
    return {
      content:
        "Error: no usable size given. Pass width as a number of pixels (0 restores the original size) " +
        "or scale as a factor, e.g. 1.25 for 25 percent larger."
    };
  }

  const change = bridge?.setImageWidth(match, request) ?? null;

  if (!change) {
    return {
      content:
        "Error: that image could not be resized. Call set_image_width again with an absolute width in pixels."
    };
  }

  const previous = change.previousWidth === null ? "an unknown width" : `${change.previousWidth} px`;

  // Explicitly "already applied": with the same wording as the proposing tools
  // the model would tell the user to accept a review that never appears.
  return {
    content:
      change.width === null
        ? `OK: the image ${change.src} is back to its original size (was ${previous}). The change is already applied to the document.`
        : `OK: the image ${change.src} is now ${change.width} px wide (was ${previous}). The change is already applied to the document.`
  };
}

// The documented name is after_text, but a model that has understood the idea
// reaches for whichever synonym it happens to produce — and dropping the
// anchor because of its key would put the text back at the caret, i.e. exactly
// the placement bug the argument exists to fix.
const INSERT_ANCHOR_KEYS = ["after_text", "after", "anchor_text", "anchor", "insert_after"];

function insertAnchorArgument(args: Record<string, unknown>): string | undefined {
  for (const key of INSERT_ANCHOR_KEYS) {
    const value = args[key];

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

/**
 * Model-facing wording per outcome. The recurring theme is "do not do it
 * again": a proposal only reaches the document once the user accepts it, so a
 * model that re-reads the document to check its own work finds nothing and
 * proposes the same thing a second time — which is exactly how two identical
 * review widgets end up stacked on the same spot.
 */
const OUTCOME_MESSAGES: Record<ProposalOutcome, string> = {
  proposed:
    "OK: change proposed. The user sees it inline and will accept or discard it. It is NOT part of the " +
    "document yet — do not call get_document to verify it, and do not propose it again.",
  duplicate:
    "Error: you already proposed exactly this text and it is still waiting for the user's review — that is " +
    "why it does not show up in get_document. Do not propose it again; just tell the user it is ready to accept.",
  "image-duplicate":
    "Error: your text embeds an image that is already in the document, which would show it twice. Write only " +
    "the new text and leave every ![alt](path) out of it — to change an image call set_image_width.",
  "anchor-not-found":
    "Error: after_text was not found in the document. Pass a few distinctive words from the single line the " +
    "new text should follow, or the path of an image (e.g. images/photo.png) to put it below that image.",
  // Repeating "copy it verbatim" is what sends a model into a retry loop — the
  // lookup already tolerates formatting differences, so a failure almost always
  // means old_text was too long or spanned several blocks. Point at the fix that
  // actually works.
  "not-found":
    "Error: passage not found. Do not retry with the same old_text. Use a shorter fragment from a single " +
    "line of the document (a few distinctive words are enough), and do not include surrounding lines.",
  failed: "Error: could not propose the change."
};

function outcomeMessage(outcome: ProposalOutcome, overrides: Partial<Record<ProposalOutcome, string>> = {}): string {
  return overrides[outcome] ?? OUTCOME_MESSAGES[outcome];
}

/**
 * Appended to every get_document answer while proposals are open. Without it
 * the document a model reads back contradicts the tool result it just got
 * ("insertion proposed") — and the model resolves that contradiction by
 * proposing the same text again.
 */
function pendingProposalNote(): string {
  const pending = bridge?.listPendingProposals() ?? [];

  if (pending.length === 0) {
    return "";
  }

  return (
    `\n\n[Note: ${pending.length} proposed change(s) are waiting for the user's review and are deliberately ` +
    "NOT part of the text above — they only appear in the document once the user accepts them. Do not " +
    `propose any of them again: ${pending.map((preview) => `"${preview}"`).join(" / ")}]`
  );
}

// An image is an atom node carrying no text, so its ![alt](path) markdown
// exists only in the serialization — no text search can ever locate it (see
// findTextRange in src/lib/editor/textSearch.ts). Without this check a model
// asked to resize an image retries the same impossible replace_passage call
// until the agent loop gives up.
const IMAGE_ONLY_PASSAGE = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;

// Tool results are short, model-facing strings rather than structured data —
// even a weak local model reliably learns "OK: selection replaced." /
// "Error: nothing is selected." as a clear signal of what worked. The chat
// UI never shows this text directly; it renders a localized status line
// keyed off the tool call's name instead (see ChatPanel).
export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (!bridge) {
    return { content: "Error: no editor is open." };
  }

  // The serializer writes checkbox brackets escaped ("- \[ \] …"), and a model
  // that copies a checklist item back from get_document hands the escaped form
  // straight to an editing tool — where markdown-it no longer recognizes it as
  // a checkbox and the item silently degrades to a plain bullet. Normalizing
  // both directions keeps the agent working with the form that round-trips.
  const asString = (value: unknown): string =>
    normalizeEscapedCheckboxes(typeof value === "string" ? value : String(value ?? ""));

  // The editing tools are off limits while an earlier turn's review is still
  // open — a new proposal next to unsettled ones is what the user has to
  // untangle afterwards. The reading tools stay available: the model still
  // needs them to work out what the user is asking for.
  if (EDITING_TOOL_NAMES.includes(name) || name === FLAG_SUGGESTION_TOOL_NAME) {
    const blocked = blockedByOpenReview();

    if (blocked) {
      return { content: blocked };
    }
  }

  switch (name) {
    case "get_document":
      return {
        content:
          (normalizeEscapedCheckboxes(bridge.getDocument()) || "(empty document)") + pendingProposalNote()
      };
    case "get_selection":
      return { content: bridge.getSelection() || "(no selection)" };
    case "get_image":
      return resolveImageArgument(args.path);
    case "set_image_width":
      return resizeImage(args);
    case "accept_proposals":
      return settleProposals(true);
    case "discard_proposals":
      return settleProposals(false);
    case "replace_selection":
      return {
        content: outcomeMessage(bridge.proposeSelectionReplacement(asString(args.new_text)), {
          proposed:
            "OK: change proposed for the selection. The user sees it inline and will accept or discard it. " +
            "It is NOT part of the document yet — do not verify it with get_document.",
          failed: "Error: nothing is selected."
        })
      };
    case "insert_at_cursor":
      return {
        content: outcomeMessage(bridge.proposeInsertion(asString(args.text), insertAnchorArgument(args)), {
          proposed:
            "OK: insertion proposed. The user sees it inline and will accept or discard it. It is NOT part " +
            "of the document yet — do not call get_document to verify it, and do not propose it again.",
          failed: "Error: could not propose an insertion."
        })
      };
    case "replace_passage": {
      const oldText = asString(args.old_text);

      if (IMAGE_ONLY_PASSAGE.test(oldText)) {
        return {
          content:
            "Error: an image cannot be edited as text — its markdown is not part of the document's text. " +
            "To change its size call set_image_width with the image path."
        };
      }

      return {
        content: outcomeMessage(bridge.proposePassageReplacement(oldText, asString(args.new_text)), {
          proposed:
            "OK: change proposed for that passage. The user sees it inline and will accept or discard it. " +
            "It is NOT part of the document yet — do not call get_document to verify it, and do not propose " +
            "it again."
        })
      };
    }
    case FLAG_SUGGESTION_TOOL_NAME:
      return {
        content:
          "OK: the user now sees a button to apply your last reply's suggestion. Wait for their decision — " +
          "do not repeat or reformulate the suggestion, and do not also propose it with an editing tool " +
          "unless the user explicitly asks you to apply it."
      };
    default:
      return { content: `Error: unknown tool "${name}".` };
  }
}
