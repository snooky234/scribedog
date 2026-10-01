/**
 * The version token of a file's bytes: SHA-256, hex. The server computes the
 * same token (server/src/vault/files.ts), so a version read from one storage
 * means the same thing as one computed here.
 *
 * Only for storages that run where `crypto.subtle` exists (the desktop
 * webview is a secure context). The browser build never hashes: its tokens
 * come from the server, and a server reached over plain http in a LAN would
 * not give it `crypto.subtle` anyway.
 */
export async function contentVersion(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));

  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function contentVersionOfText(text: string): Promise<string> {
  return contentVersion(new TextEncoder().encode(text));
}
