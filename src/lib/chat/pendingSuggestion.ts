// Decides whether an assistant reply gets the "apply to document" button.
//
// The button must only appear on a reply that offers the user a change which is
// not already waiting for review in the editor — showing it on every answer is
// what made it noise. Only the model can tell those apart, so the decision is
// its own flag_pending_suggestion call rather than a heuristic over the reply
// text.
//
// Inside a turn the model calls that tool itself (see AGENT_INSTRUCTION rule 9).
// But the case the flag exists for is precisely the case where the model
// considered its reply finished — it wrote the offer as prose and returned no
// tool calls at all, which ends the agent loop before anything can be flagged.
// So when a turn ends that way, the store asks the question explicitly here.
//
// The question is a fresh one-shot request, not another step of the
// conversation: it carries only the user's request and the reply being judged
// (cheap, and everything the judgement needs), replaces the whole system prompt,
// and offers the one tool it asks about — so the model cannot propose or change
// anything while answering, and the request never enters the stored history.

import { generateAiChatStep, FLAG_SUGGESTION_TOOL_NAME } from "@/lib/aiClient";
import { type AiSettings } from "@/store/useAiSettingsStore";

const CLASSIFIER_SYSTEM =
  "You judge a single reply that a writing assistant gave about the user's document, and you answer only " +
  `by either calling ${FLAG_SUGGESTION_TOOL_NAME} or writing "no".`;

// How much of either text the question carries. The decision turns on what the
// reply offers, which is clear from its opening — and a runaway reply must not
// blow up a request whose whole point is to be cheap.
const EXCERPT_CHARS = 2000;

function excerpt(text: string): string {
  const trimmed = text.trim();

  return trimmed.length > EXCERPT_CHARS ? `${trimmed.slice(0, EXCERPT_CHARS)}…` : trimmed;
}

function question(userRequest: string, assistantReply: string): string {
  return [
    "A writing assistant is helping the user edit their document. It can propose changes as reviewable " +
      "edits, but in the turn below it did not propose anything — it only replied with text.",
    "",
    `The user asked:\n"""\n${excerpt(userRequest)}\n"""`,
    "",
    `The assistant replied:\n"""\n${excerpt(assistantReply)}\n"""`,
    "",
    "Does that reply offer the user a change to their document that has NOT been carried out? It does if " +
      "the reply spells out new or rewritten wording for the document, describes a rewrite it is ready to " +
      "make, or asks whether it should apply one. It does NOT if the reply merely answers a question, " +
      "explains or discusses something, reports what the document says, asks what the user wants, or " +
      "confirms a change that is already done.",
    "",
    `If it does offer such a change, call ${FLAG_SUGGESTION_TOOL_NAME} — the user then gets a button to ` +
      'apply it. Otherwise reply with just "no". Do not explain your decision.'
  ].join("\n");
}

/**
 * Asks the model whether the reply it just finished offers an unapplied change.
 *
 * Answers false on any failure: the button is an affordance, so a failed extra
 * request must leave the finished turn alone rather than surface as an error.
 */
export async function detectPendingSuggestion(
  settings: AiSettings,
  userRequest: string,
  assistantReply: string,
  signal?: AbortSignal
): Promise<boolean> {
  if (!assistantReply.trim()) {
    return false;
  }

  try {
    const step = await generateAiChatStep(
      settings,
      {
        messages: [{ role: "user", content: question(userRequest, assistantReply) }],
        assistantInstruction: "",
        systemOverride: CLASSIFIER_SYSTEM,
        toolNames: [FLAG_SUGGESTION_TOOL_NAME]
      },
      signal
    );

    return step.toolCalls.some((call) => call.name === FLAG_SUGGESTION_TOOL_NAME);
  } catch {
    return false;
  }
}
