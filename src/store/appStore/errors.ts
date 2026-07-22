/**
 * Store actions report failures through the `folderError`/`fileError`/
 * `saveError` fields instead of throwing, so every catch block needs a
 * displayable string. Callers pass an already-translated fallback, since the
 * store runs outside React and resolves its own messages via i18n.t.
 */
export function toErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  return fallbackMessage;
}
