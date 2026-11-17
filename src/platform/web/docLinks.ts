import type { DocLinkTarget, DocLinksApi } from "@/platform/types";

import { REMOTE_VAULT_ROOT } from "./remoteStorage";
import { sharedVaultIdOf, sharedVaultRoot } from "./sharedVaultRoot";

/**
 * Every open document has an address in the browser, so it can be bookmarked,
 * sent as a link, reloaded and stepped through with the browser's back and
 * forward buttons:
 *
 *   #/doc/Projects/Roadmap.md             a document of the instance's own vault
 *   #/v/1a2b/doc/Projects/Roadmap.md      a document of shared vault 1a2b
 *
 * Why the fragment and not a real path: the web build loads its bundles
 * relative to index.html, which a path like /Projects/Roadmap.md would break,
 * and a fragment never reaches the server, so document names stay out of the
 * server's and every proxy's access log.
 *
 * The `doc` segment names the view, not the file type, and is what keeps the
 * address space open: later routes (`#/folder/…`, `#/id/…`, `#/search/…`)
 * sit next to it without ever being mistaken for a document in a folder of
 * that name. `v/<id>` matches the shared vault's API scope and uses its id,
 * which survives a rename of the vault.
 *
 * The path is relative to the vault root, POSIX, each segment percent-encoded
 * (spaces, umlauts, `#` and `?` in names). Anything after a `?` is ignored, so
 * an older client still opens a link a newer one added parameters to.
 *
 * Parsing only answers which document the address names. Whether it exists
 * is the caller's question: only a path the vault listing contains is ever
 * opened, which is also why a `..` in the address could not reach outside the
 * vault. It is refused here all the same, as is any segment that does not
 * decode.
 */

const DOC_SEGMENT = "doc";
const SHARED_SEGMENT = "v";
const SHARED_ID_PATTERN = /^[0-9a-f]{4,16}$/;

function encodePath(relativePath: string): string {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The vault-relative POSIX path of a file inside `folderPath`; null outside it. */
function relativeTo(folderPath: string, filePath: string): string | null {
  const root = folderPath.replace(/\/+$/, "");
  const prefix = `${root}/`;

  return filePath.startsWith(prefix) && filePath.length > prefix.length ? filePath.slice(prefix.length) : null;
}

/**
 * The fragment (with the leading `#`) for a document, or `""` for "no
 * document": an empty address. Null for a vault the browser cannot name,
 * which leaves the address as it is.
 */
export function formatDocHash(target: DocLinkTarget | null): string | null {
  if (!target) {
    return "";
  }

  const sharedId = sharedVaultIdOf(target.folderPath);
  const vaultPrefix = sharedId ? `#/${SHARED_SEGMENT}/${sharedId}` : target.folderPath === REMOTE_VAULT_ROOT ? "#" : null;

  if (vaultPrefix === null) {
    return null;
  }

  const relativePath = relativeTo(target.folderPath, target.filePath);

  return relativePath === null ? null : `${vaultPrefix}/${DOC_SEGMENT}/${encodePath(relativePath)}`;
}

/** The document a fragment names, or null for anything that is not a document address. */
export function parseDocHash(hash: string): DocLinkTarget | null {
  const withoutQuery = hash.replace(/^#/, "").split("?")[0];

  if (!withoutQuery.startsWith("/")) {
    return null;
  }

  const segments = withoutQuery.slice(1).split("/");
  let folderPath = REMOTE_VAULT_ROOT;

  if (segments[0] === SHARED_SEGMENT) {
    const id = segments[1] ?? "";

    if (!SHARED_ID_PATTERN.test(id)) {
      return null;
    }

    folderPath = sharedVaultRoot(id);
    segments.splice(0, 2);
  }

  if (segments[0] !== DOC_SEGMENT || segments.length < 2) {
    return null;
  }

  const pathSegments: string[] = [];

  for (const raw of segments.slice(1)) {
    const segment = decodeSegment(raw);

    if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
      return null;
    }

    pathSegments.push(segment);
  }

  return { folderPath, filePath: `${folderPath}/${pathSegments.join("/")}` };
}

function sameTarget(a: DocLinkTarget | null, b: DocLinkTarget | null): boolean {
  return a === b || (a !== null && b !== null && a.folderPath === b.folderPath && a.filePath === b.filePath);
}

export const browserDocLinks: DocLinksApi = {
  current: () => parseDocHash(window.location.hash),

  show: (target, options) => {
    const hash = formatDocHash(target);

    if (hash === null || sameTarget(parseDocHash(window.location.hash), target)) {
      return;
    }

    // The first document of a tab replaces the bare address instead of
    // stacking an entry behind it that only leads back to "nothing open";
    // closing the document does the same, so back skips the empty state.
    const replace = options?.replace === true || target === null || parseDocHash(window.location.hash) === null;
    const url = `${window.location.pathname}${window.location.search}${hash}`;

    if (replace) {
      window.history.replaceState(window.history.state, "", url);
    } else {
      window.history.pushState(null, "", url);
    }
  },

  urlFor: (target) => {
    const hash = formatDocHash(target);

    return hash ? `${window.location.origin}${window.location.pathname}${window.location.search}${hash}` : null;
  },

  subscribe: (handler) => {
    // pushState and replaceState fire neither event, so this only sees what
    // the person did: back, forward, an edited address, a clicked link.
    // Both events fire for a fragment change; the second one finds the
    // document already open, which the handler treats as nothing to do.
    const listener = () => handler(parseDocHash(window.location.hash));

    window.addEventListener("hashchange", listener);
    window.addEventListener("popstate", listener);

    return () => {
      window.removeEventListener("hashchange", listener);
      window.removeEventListener("popstate", listener);
    };
  }
};
