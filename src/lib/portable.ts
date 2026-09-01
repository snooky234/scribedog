import { invoke } from "@tauri-apps/api/core";

/**
 * "on" — the app keeps its own files next to the executable.
 * "readOnly" — the portable marker was found, but that folder cannot be
 * written to (`C:\Program Files`, a read-only medium). The app falls back to
 * the OS directories, which is worth telling the user about: they expected the
 * machine to stay clean.
 */
export type PortableMode = "off" | "on" | "readOnly";

export type PortableStatus = {
  mode: PortableMode;
  /** Where the frontend writes the files it owns (shortcuts.json). */
  configDir: string;
};

const NOT_PORTABLE: PortableStatus = { mode: "off", configDir: "" };

let pending: Promise<PortableStatus> | null = null;

function hasTauriShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Resolved once per session — the Rust side detects the mode once at startup,
 * and the call also widens the fs scope to the returned directory, so repeating
 * it would only repeat that.
 */
export function getPortableStatus(): Promise<PortableStatus> {
  if (!hasTauriShell()) {
    return Promise.resolve(NOT_PORTABLE);
  }

  pending ??= invoke<PortableStatus>("get_portable_status").catch(() => NOT_PORTABLE);

  return pending;
}
