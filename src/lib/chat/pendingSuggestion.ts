// Decides what becomes of an assistant reply that ended a turn without touching
// the document — either the reply's text goes into the document as a proposal
// after all, or the reply gets the "apply to document" button, or neither.
//
// Both outcomes exist because of the same failure: the model considered its
// reply finished and returned no tool calls at all, which ends the agent loop
// before rule 2a or rule 9 of AGENT_INSTRUCTION can be applied. The turn is
// over, so nothing inside it can still react — the store asks the question here
// instead.
//
// Which of the two outcomes is right turns on what the reply is. Text the user
// asked to have *written* (a draft, a continuation, the first content of an
// empty note) is answered by putting it in the document: a button that makes
// the user ask a second time for what they already asked for is a detour, not
// an affordance. A reply that merely offers or describes a change to existing
// wording gets the button, because working it in means locating and rewriting
// passages — which needs the document, and this step never sees it.
//
// The question is a fresh one-shot request, not another step of the
// conversation: it carries only the user's request and the reply being judged
// (cheap, and everything the judgement needs), replaces the whole system prompt,
// and offers just the two tools it asks about — so the model cannot go looking
// around the document while answering, and the request never enters the stored
// history.

import {
  generateAiChatStep,
  resolveMaxOutputTokens,
  FLAG_SUGGESTION_TOOL_NAME,
  INSERT_TOOL_NAME
} from "@/lib/aiClient";
import { type AiSettings } from "@/store/useAiSettingsStore";

const CLASSIFIER_SYSTEM =
  "You judge a single reply that a writing assistant gave about the user's document, and you answer only " +
  `by calling ${INSERT_TOOL_NAME} or ${FLAG_SUGGESTION_TOOL_NAME}, or by writing "no".`;

// How much of the user's request the question carries. What was asked for is
// clear from its opening, and a pasted wall of text must not blow up a request
// whose whole point is to be cheap.
const REQUEST_EXCERPT_CHARS = 2000;

// The reply, by contrast, travels in FULL whenever case (a) is on the table:
// the step has to hand the document text back verbatim, and text it never saw
// is text it cannot hand back. Judging a solution sheet by its first 2000
// characters and then inserting those is worse than not inserting at all.
//
// Above the ceiling the reply is too long to come back through a single answer
// (see resolveMaxOutputTokens — 4096 tokens at most, so this stays well under
// what fits even at a pessimistic 2 characters per token), so case (a) is
// dropped and only the button question is asked, on an excerpt as before.
function insertableReplyLimit(contextLength: number): number {
  return resolveMaxOutputTokens(contextLength) * 2;
}

/**
 * What to do with the reply.
 *
 * "insert" carries the document text alone: the reply's greeting, its
 * explanation of what it wrote and its closing question are chat, and putting
 * them into the document would be worse than leaving everything in the chat.
 */
export type UnflaggedReplyVerdict =
  | { kind: "none" }
  | { kind: "flag" }
  | { kind: "insert"; text: string };

function excerpt(text: string, limit: number): string {
  const trimmed = text.trim();

  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

function question(userRequest: string, assistantReply: string, canInsert: boolean): string {
  const cases = [
    canInsert
      ? "(a) The user asked the assistant to write something NEW for their document — compose a text, draft " +
        "a section, continue what is there, write the first content of an empty note — and the reply spells " +
        `that new text out. Then call ${INSERT_TOOL_NAME} with exactly that text as its "text" argument: ` +
        'leave out the assistant\'s own words about it (greetings, "here is a draft:", explanations of what ' +
        "it did, questions at the end) and keep only what belongs in the document, reproduced word for word " +
        "and complete to its last line, with its Markdown formatting unchanged. Do not pass after_text."
      : "",
    "(b) The reply offers a change to wording that is ALREADY in the document — it rewrites, shortens or " +
      "corrects an existing passage, describes a rewrite it is ready to make, or asks whether it should " +
      `apply one${canInsert ? "" : ", or it wrote new text for the document"}. Then call ` +
      `${FLAG_SUGGESTION_TOOL_NAME}; the user gets a button for it.`,
    "(c) Neither: the reply answers a question, explains or discusses something, reports what the document " +
      'says, asks the user what they want, or confirms a change that is already done. Then reply with just "no".'
  ].filter(Boolean);

  return [
    "A writing assistant is helping the user write and edit their document. It can put text into the " +
      "document as a proposal the user reviews, but in the turn below it proposed nothing — it only " +
      "replied with text in the chat.",
    "",
    `The user asked:\n"""\n${excerpt(userRequest, REQUEST_EXCERPT_CHARS)}\n"""`,
    "",
    // Not excerpted when case (a) is offered: see insertableReplyLimit.
    `The assistant replied:\n"""\n${
      canInsert ? assistantReply.trim() : excerpt(assistantReply, REQUEST_EXCERPT_CHARS)
    }\n"""`,
    "",
    "Decide which one of these the reply is:",
    "",
    cases.join("\n\n"),
    "",
    "Do not explain your decision."
  ].join("\n");
}

/**
 * Asks the model what the reply it just finished was.
 *
 * Answers "none" on any failure: this is a convenience on top of a turn that is
 * already on screen, so a failed extra request must leave that turn alone rather
 * than surface as an error.
 */
export async function resolveUnflaggedReply(
  settings: AiSettings,
  userRequest: string,
  assistantReply: string,
  signal?: AbortSignal
): Promise<UnflaggedReplyVerdict> {
  if (!assistantReply.trim()) {
    return { kind: "none" };
  }

  const canInsert = assistantReply.trim().length <= insertableReplyLimit(settings.contextLength);

  try {
    const step = await generateAiChatStep(
      settings,
      {
        messages: [{ role: "user", content: question(userRequest, assistantReply, canInsert) }],
        assistantInstruction: "",
        systemOverride: CLASSIFIER_SYSTEM,
        toolNames: canInsert ? [INSERT_TOOL_NAME, FLAG_SUGGESTION_TOOL_NAME] : [FLAG_SUGGESTION_TOOL_NAME]
      },
      signal
    );

    const insertion = step.toolCalls.find((call) => call.name === INSERT_TOOL_NAME);
    const text = typeof insertion?.arguments.text === "string" ? insertion.arguments.text.trim() : "";

    if (text) {
      return { kind: "insert", text };
    }

    // An insertion call with no usable text falls through to the button rather
    // than to nothing: the model did decide the reply was worth applying.
    if (insertion || step.toolCalls.some((call) => call.name === FLAG_SUGGESTION_TOOL_NAME)) {
      return { kind: "flag" };
    }

    return { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}
