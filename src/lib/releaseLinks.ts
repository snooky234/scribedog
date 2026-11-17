export const RELEASES_URL = "https://github.com/snooky234/scribedog/releases";

export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;

/**
 * The release overview, scrolled to the installed version. GitHub gives every
 * entry on that page the id `release-<tag>`, so the newer releases sit right
 * above it. The overview only lists the most recent releases; for an older
 * version the anchor simply does not match and the page opens at the top,
 * which shows the newest changes, not an error.
 */
export function releaseNotesUrl(version: string | null | undefined): string {
  const trimmed = version?.trim().replace(/^v/i, "");
  return trimmed ? `${RELEASES_URL}#release-v${encodeURIComponent(trimmed)}` : RELEASES_URL;
}
