import type { AiChatMessage } from "@/lib/aiClient";

// Share of the configured context window handed to the model as conversation
// history. The rest is reserved for the system prompt and the model's own
// answer, so a small local model never has its context overrun.
const CONTEXT_BUDGET_RATIO = 0.6;

// Rough per-message framing overhead (role tag, separators) on top of the
// content itself, in the same chars/4 token unit used below.
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

// Dependency-free token estimate. Deliberately crude (chars/4) — a precise
// tokenizer is a later refinement; this only needs to keep the context from
// overflowing, not to be exact.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Picks the tail of the conversation that fits the model's budget.
 *
 * The store keeps the full history as the source of truth; this derives the
 * trimmed view actually sent to the model and is never persisted. The system
 * prompt is always charged against the budget first (it is sent every turn),
 * then messages are kept newest-first until the budget is exhausted. The most
 * recent message is always included even if it alone exceeds the budget —
 * dropping the latest user turn would make the request pointless.
 */
export function selectMessagesForModel(
  messages: AiChatMessage[],
  systemPrompt: string,
  contextLength: number
): AiChatMessage[] {
  const budget = Math.max(0, Math.floor(contextLength * CONTEXT_BUDGET_RATIO));
  let used = estimateTokens(systemPrompt);
  const selected: AiChatMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const cost = estimateTokens(messages[i].content) + PER_MESSAGE_OVERHEAD_TOKENS;

    if (used + cost > budget && selected.length > 0) {
      break;
    }

    used += cost;
    selected.unshift(messages[i]);
  }

  // A trimmed window must start on a user turn: besides Anthropic rejecting
  // anything else outright, a leading "tool" message or an "assistant"
  // message with toolCalls would be an orphaned half of a tool-call/
  // tool-result pair with its partner trimmed away, which every provider
  // rejects. Drop leading turns until the window starts clean.
  while (selected.length > 0 && selected[0].role !== "user") {
    selected.shift();
  }

  return selected;
}
