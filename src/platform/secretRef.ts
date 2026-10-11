/**
 * The placeholder that stands in for an API key in the browser.
 *
 * In the server edition the key itself never reaches the tab: it is stored
 * encrypted in the data volume (`/api/secrets`), and everything that would
 * carry the key on the desktop carries `{{scribedog-secret:openai}}` here
 * instead. `aiClient.ts` passes it along like any other string, and the
 * server's LLM proxy swaps in the real key right before the request leaves
 * for the provider.
 *
 * Two consequences worth knowing when touching this:
 *
 * - Anything that checks "is a key set" keeps working, because a placeholder
 *   is a non-empty string (`assertValidEndpoint`).
 * - Anything that *shows* the key has to ask `isSecretRef` first and show
 *   "stored" rather than the placeholder text.
 *
 * Shared rather than web-only so the settings dialog, which both shells
 * render, can ask `isSecretRef` without importing from a platform folder it
 * may not be built with.
 *
 * Keep in step with server/src/secrets/secretRef.ts, which resolves these.
 */

const PREFIX = "{{scribedog-secret:";
const SUFFIX = "}}";

export function secretRef(id: string): string {
  return `${PREFIX}${id}${SUFFIX}`;
}

export function isSecretRef(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX) && value.endsWith(SUFFIX);
}

/** True when a placeholder appears anywhere in `value`, e.g. "Bearer {{scribedog-secret:jan}}". */
export function containsSecretRef(value: string): boolean {
  return value.includes(PREFIX);
}
