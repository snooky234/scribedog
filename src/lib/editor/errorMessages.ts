import type { TFunction } from "i18next";

export function extractErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return t("editor.aiResponseError");
  }
}

// How the providers say that the request did not fit into the context window.
// Most say it outright (OpenAI, Mistral, Anthropic, llama.cpp, LM Studio); a
// Qwen-style chat template in LM Studio or Jan says it sideways: the server
// cut the oldest messages to make room, the user's question went with them,
// and the template then raises "No user query found in messages".
const CONTEXT_OVERFLOW = [
  /context[_ ]length[_ ]exceeded/i,
  /maximum context length/i,
  /exceeds? (the )?(available )?context/i,
  /context (size|window) (has been )?exceeded/i,
  /context length of only/i,
  /prompt is too long/i,
  /too large for model with \d+ maximum context/i,
  /no user query found in messages/i
];

export function isContextOverflowError(message: string): boolean {
  return CONTEXT_OVERFLOW.some((pattern) => pattern.test(message));
}

// Appends a context-specific tip to an AI error, chosen from the raw message:
// a context window that is too small, model/response problems, connection
// problems, or a generic fallback.
export function formatAiError(error: unknown, t: TFunction): string {
  console.error("AI request failed:", error);

  const rawMessage = extractErrorMessage(error, t) || t("editor.aiResponseError");

  // Replaces the raw message rather than adding to it: what the server says
  // here (a Jinja traceback, a token count) does not help the user, the two
  // ways out do. The raw error is in the console above.
  if (isContextOverflowError(rawMessage)) {
    return t("editor.aiContextTooSmall");
  }

  if (
    /modell|model/i.test(rawMessage) ||
    /kein verwertbarer text|no usable text/i.test(rawMessage) ||
    /invalid/i.test(rawMessage)
  ) {
    return `${rawMessage} ${t("editor.aiTipModel")}`;
  }

  if (
    /lokalen http-endpunkt|local http endpoint/i.test(rawMessage) ||
    /network|fetch|verbind|connection/i.test(rawMessage)
  ) {
    return `${rawMessage} ${t("editor.aiTipConnection")}`;
  }

  return `${rawMessage} ${t("editor.aiTipGeneric")}`;
}
