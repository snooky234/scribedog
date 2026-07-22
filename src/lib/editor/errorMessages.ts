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

// Appends a context-specific tip to an AI error, chosen from the raw message:
// model/response problems, connection problems, or a generic fallback.
export function formatAiError(error: unknown, t: TFunction): string {
  console.error("AI request failed:", error);

  const rawMessage = extractErrorMessage(error, t) || t("editor.aiResponseError");

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
