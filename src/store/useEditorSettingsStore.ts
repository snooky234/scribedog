import { create } from "zustand";

import {
  clampFontSizePt,
  DEFAULT_FONT_ID,
  DEFAULT_FONT_SIZE_PT,
  ensureFontStylesLoaded,
  getFontDefinition,
  getFontScale,
  resolveFontId,
  type AppFontId,
  type TableWidth
} from "@/lib/fonts";

// Defined with DocumentStyle rather than here: the export carries the same
// value, and one definition keeps the two from drifting apart.
export type { TableWidth };
import { clampOutlineDepth, OUTLINE_DEPTH_MAX } from "@/lib/editor/documentOutline";
import {
  defaultPageSizeForLocale,
  resolvePageMargins,
  resolvePageSize,
  type PageMarginId,
  type PageSizeId
} from "@/lib/pageSetup";
import { clampPageWidthEm, parseStoredPageWidth } from "@/lib/editor/pageWidth";
import { clampZenFontSizePt } from "@/lib/zenFontZoom";
import {
  DEFAULT_HEADING_NUMBERING,
  normalizeHeadingNumberingSettings,
  type HeadingNumberingSettings
} from "@/lib/editor/headingNumbers";
import {
  readFolderNotesEnabled,
  readHeadingNumbering,
  writeFolderNotesEnabled,
  writeHeadingNumbering
} from "@/lib/vaultMeta";
import { setAutoAdmitWorkingSetProvider, setRestoreWorkingSetProvider } from "@/store/appStore/workingSetSlice";

export const SPELLCHECK_STORAGE_KEY = "scribedog-spellcheck-enabled";
export const PAGE_LINES_STORAGE_KEY = "scribedog-page-lines-enabled";
export const REOPEN_LAST_NOTE_STORAGE_KEY = "scribedog-reopen-last-note";
export const DETAILS_PANEL_STORAGE_KEY = "scribedog-details-panel-visible";
export const OUTLINE_DEPTH_STORAGE_KEY = "scribedog-outline-max-depth";
export const DETAILS_COLLAPSED_STORAGE_KEY = "scribedog-details-collapsed-sections";

/** The details panel's sections, each of which can be folded away. */
export type DetailsSectionId = "outline" | "fileInfo" | "outgoingLinks" | "backlinks";
export const ZOOM_STORAGE_KEY = "scribedog-zoom-level";
export const ZEN_WIDTH_STORAGE_KEY = "scribedog-zen-width";
export const PAGE_WIDTH_STORAGE_KEY = "scribedog-page-width";
export const ZEN_FONT_SIZE_STORAGE_KEY = "scribedog-zen-font-size-pt";
export const VIEW_FONT_SIZE_STORAGE_KEY = "scribedog-view-font-size-pt";
export const FONT_STORAGE_KEY = "scribedog-font-id";
export const FONT_SIZE_STORAGE_KEY = "scribedog-font-size-pt";
export const PAPER_SURFACE_STORAGE_KEY = "scribedog-paper-surface";
export const TABLE_WIDTH_STORAGE_KEY = "scribedog-table-width";
export const PAGE_SIZE_STORAGE_KEY = "scribedog-page-size";
export const PAGE_MARGINS_STORAGE_KEY = "scribedog-page-margins";
export const AUTO_SAVE_STORAGE_KEY = "scribedog-auto-save-enabled";
export const RESTORE_WORKING_SET_STORAGE_KEY = "scribedog-restore-working-set";
export const AUTO_ADMIT_WORKING_SET_STORAGE_KEY = "scribedog-auto-admit-working-set";
export const OPEN_ON_DOUBLE_CLICK_STORAGE_KEY = "scribedog-open-on-double-click";
export const PASTE_MARKDOWN_STORAGE_KEY = "scribedog-paste-markdown";
export const AI_FEATURES_VISIBLE_STORAGE_KEY = "scribedog-ai-features-visible";

// Zoom level is an offset in percent relative to normal size (0 = 100%).
export const ZOOM_MIN = -30;
export const ZOOM_MAX = 50;
export const ZOOM_STEP = 10;

// Zen-mode text-column width in pixels. Applies only to Zen mode; normal
// editing keeps its own layout.
export const ZEN_WIDTH_MIN = 360;
export const ZEN_WIDTH_MAX = 1400;
export const ZEN_WIDTH_DEFAULT = 760;
export const ZEN_WIDTH_STEP = 40;

export function clampZoomLevel(level: number): number {
  const stepped = Math.round(level / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped));
}

export function clampZenWidth(width: number): number {
  return Math.min(ZEN_WIDTH_MAX, Math.max(ZEN_WIDTH_MIN, Math.round(width)));
}

function getStoredZoomLevel(): number {
  try {
    const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampZoomLevel(parsed) : 0;
  } catch {
    return 0;
  }
}

function persistZoomLevel(level: number): void {
  try {
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(level));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredZenWidth(): number {
  try {
    const raw = window.localStorage.getItem(ZEN_WIDTH_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampZenWidth(parsed) : ZEN_WIDTH_DEFAULT;
  } catch {
    return ZEN_WIDTH_DEFAULT;
  }
}

function getStoredPageWidthEm(): number | null {
  try {
    return parseStoredPageWidth(window.localStorage.getItem(PAGE_WIDTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

function persistPageWidthEm(widthEm: number | null): void {
  try {
    if (widthEm === null) {
      window.localStorage.removeItem(PAGE_WIDTH_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PAGE_WIDTH_STORAGE_KEY, String(widthEm));
    }
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function persistZenWidth(width: number): void {
  try {
    window.localStorage.setItem(ZEN_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredZoomFontSizePt(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(parsed) ? clampZenFontSizePt(parsed) : null;
  } catch {
    return null;
  }
}

function persistZoomFontSizePt(key: string, sizePt: number | null): void {
  try {
    if (sizePt === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, String(sizePt));
    }
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredSpellcheckEnabled(): boolean {
  try {
    return window.localStorage.getItem(SPELLCHECK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

// Off by default: the layout runs in the background after every pause in
// typing, which nobody should pay for without asking.
function getStoredPageLinesEnabled(): boolean {
  try {
    return window.localStorage.getItem(PAGE_LINES_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistPageLinesEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(PAGE_LINES_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function persistSpellcheckEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SPELLCHECK_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

// Off by default: existing users save with Ctrl+S on purpose, "discard
// changes" is a free undo level for a whole session that auto-save takes
// away, and every write is an upload for a synced or remote vault.
function getStoredAutoSaveEnabled(): boolean {
  try {
    return window.localStorage.getItem(AUTO_SAVE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistAutoSaveEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(AUTO_SAVE_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

// On by default: the app already reopens the last note per vault, and a
// list of notes in progress that did not come back with it would be the odd
// one out. Whoever wants a clean start every day switches it off once.
function getStoredRestoreWorkingSet(): boolean {
  try {
    return window.localStorage.getItem(RESTORE_WORKING_SET_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function persistRestoreWorkingSet(enabled: boolean): void {
  try {
    window.localStorage.setItem(RESTORE_WORKING_SET_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

// Off by default: the "In progress" list is something the user sets up by
// pinning, not something the app opens on the first keystroke. A section that
// appears by itself is one more thing on screen that nobody asked for; found
// through a double-click it is the user's own.
function getStoredAutoAdmitWorkingSet(): boolean {
  try {
    return window.localStorage.getItem(AUTO_ADMIT_WORKING_SET_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistAutoAdmitWorkingSet(enabled: boolean): void {
  try {
    window.localStorage.setItem(AUTO_ADMIT_WORKING_SET_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

// Off by default: a click opens a note, as it always has. See
// lib/openGesture.ts for what the other mode changes.
function getStoredOpenOnDoubleClick(): boolean {
  try {
    return window.localStorage.getItem(OPEN_ON_DOUBLE_CLICK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistOpenOnDoubleClick(enabled: boolean): void {
  try {
    window.localStorage.setItem(OPEN_ON_DOUBLE_CLICK_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

// On by default: pasted "# Heading" is meant as a heading far more often
// than as three characters, and Ctrl+Shift+V still pastes the raw text.
function getStoredPasteMarkdown(): boolean {
  try {
    return window.localStorage.getItem(PASTE_MARKDOWN_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function persistPasteMarkdown(enabled: boolean): void {
  try {
    window.localStorage.setItem(PASTE_MARKDOWN_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

// On by default: hiding is for the user who knows there is no model to talk
// to (typically on the server edition). The AI configuration itself stays
// untouched, so switching back on finds everything as it was.
function getStoredAiFeaturesVisible(): boolean {
  try {
    return window.localStorage.getItem(AI_FEATURES_VISIBLE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function persistAiFeaturesVisible(visible: boolean): void {
  try {
    window.localStorage.setItem(AI_FEATURES_VISIBLE_STORAGE_KEY, String(visible));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

// On by default: the app already returns to the last folder, and stopping
// one step short of the note is the step the user then takes every time.
function getStoredReopenLastNote(): boolean {
  try {
    return window.localStorage.getItem(REOPEN_LAST_NOTE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function persistReopenLastNote(enabled: boolean): void {
  try {
    window.localStorage.setItem(REOPEN_LAST_NOTE_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredDetailsPanelVisible(): boolean {
  try {
    return window.localStorage.getItem(DETAILS_PANEL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistDetailsPanelVisible(visible: boolean): void {
  try {
    window.localStorage.setItem(DETAILS_PANEL_STORAGE_KEY, String(visible));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredOutlineMaxDepth(): number {
  try {
    const raw = window.localStorage.getItem(OUTLINE_DEPTH_STORAGE_KEY);
    return raw === null ? OUTLINE_DEPTH_MAX : clampOutlineDepth(Number.parseInt(raw, 10));
  } catch {
    return OUTLINE_DEPTH_MAX;
  }
}

function persistOutlineMaxDepth(depth: number): void {
  try {
    window.localStorage.setItem(OUTLINE_DEPTH_STORAGE_KEY, String(depth));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredCollapsedDetailsSections(): DetailsSectionId[] {
  try {
    const raw = window.localStorage.getItem(DETAILS_COLLAPSED_STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is DetailsSectionId => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function persistCollapsedDetailsSections(ids: DetailsSectionId[]): void {
  try {
    window.localStorage.setItem(DETAILS_COLLAPSED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredPaperSurface(): boolean {
  try {
    return window.localStorage.getItem(PAPER_SURFACE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistPaperSurface(enabled: boolean): void {
  try {
    window.localStorage.setItem(PAPER_SURFACE_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredTableWidth(): TableWidth {
  try {
    return window.localStorage.getItem(TABLE_WIDTH_STORAGE_KEY) === "content" ? "content" : "full";
  } catch {
    return "full";
  }
}

function persistTableWidth(width: TableWidth): void {
  try {
    window.localStorage.setItem(TABLE_WIDTH_STORAGE_KEY, width);
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

// Until the user picks one, the paper size follows the region of the
// system language on every start (Letter in the US, A4 in Germany), so it is
// only written once it was chosen.
function getStoredPageSize(): PageSizeId {
  try {
    const stored = resolvePageSize(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));

    if (stored) {
      return stored;
    }
  } catch {
    // localStorage may be unavailable in some environments.
  }

  return defaultPageSizeForLocale(typeof navigator === "undefined" ? undefined : navigator.language);
}

function persistPageSize(size: PageSizeId): void {
  try {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, size);
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredPageMargins(): PageMarginId {
  try {
    return resolvePageMargins(window.localStorage.getItem(PAGE_MARGINS_STORAGE_KEY));
  } catch {
    return resolvePageMargins(null);
  }
}

function persistPageMargins(margins: PageMarginId): void {
  try {
    window.localStorage.setItem(PAGE_MARGINS_STORAGE_KEY, margins);
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredFontId(): AppFontId {
  try {
    return resolveFontId(window.localStorage.getItem(FONT_STORAGE_KEY));
  } catch {
    return DEFAULT_FONT_ID;
  }
}

function persistFontId(fontId: AppFontId): void {
  try {
    window.localStorage.setItem(FONT_STORAGE_KEY, fontId);
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredFontSizePt(): number {
  try {
    const raw = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    return raw === null ? DEFAULT_FONT_SIZE_PT : clampFontSizePt(Number.parseFloat(raw));
  } catch {
    return DEFAULT_FONT_SIZE_PT;
  }
}

function persistFontSizePt(sizePt: number): void {
  try {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(sizePt));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

type EditorSettingsState = {
  spellcheckEnabled: boolean;
  setSpellcheckEnabled: (enabled: boolean) => void;
  /**
   * Show where the pages of the PDF export end, as lines in the editor
   * (components/editor/usePageLines.ts). Display only: the export is the
   * same either way.
   */
  pageLinesEnabled: boolean;
  setPageLinesEnabled: (enabled: boolean) => void;
  /**
   * Save the open note on its own once typing has paused (see
   * hooks/useAutoSave.ts). App-wide, not per vault: it is a way of working,
   * not a property of a folder.
   */
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: (enabled: boolean) => void;
  /**
   * Put the "In progress" list back when a vault is opened
   * (store/appStore/workingSetSlice.ts). Only the list: notes with unsaved
   * edits always come back through their drafts and re-enter the list by the
   * admission rule, so switching this off never loses anything.
   */
  restoreWorkingSet: boolean;
  setRestoreWorkingSet: (enabled: boolean) => void;
  /**
   * Let a note into the "In progress" list the moment it is edited. Off, only
   * pinning (the tree's pin, Shift+Enter, context menu, and a double-click
   * where a click opens) admits a note; unsaved edits are kept and shown in
   * the tree either way.
   */
  autoAdmitWorkingSet: boolean;
  setAutoAdmitWorkingSet: (enabled: boolean) => void;
  /**
   * A click in the sidebar only marks a note; double-click or Enter opens it
   * (lib/openGesture.ts). Ignored on a touch screen.
   */
  openOnDoubleClick: boolean;
  setOpenOnDoubleClick: (enabled: boolean) => void;
  /**
   * Convert plain-text clipboard content that looks like Markdown on paste
   * (see lib/editor/pasteMarkdown.ts). Ctrl+Shift+V bypasses it either way.
   */
  pasteMarkdown: boolean;
  setPasteMarkdown: (enabled: boolean) => void;
  /**
   * Show the AI features: toolbar buttons, chat, the AI entries in menus and
   * shortcuts, and the AI settings pages. Off hides them and keeps the
   * knowledge base from updating in the background; the settings survive.
   */
  aiFeaturesVisible: boolean;
  setAiFeaturesVisible: (visible: boolean) => void;
  /** Open the note that was open in the vault last time when it is opened again. */
  reopenLastNote: boolean;
  setReopenLastNote: (enabled: boolean) => void;
  /**
   * Document font, shared by the editor and every export format. Selecting it
   * pulls in the family's faces on demand (see src/lib/fonts.ts).
   */
  fontId: AppFontId;
  setFontId: (fontId: AppFontId) => void;
  /** Document body size in points; travels into every export. */
  fontSizePt: number;
  setFontSizePt: (sizePt: number) => void;
  /**
   * Keep the editing surface a white page while the UI is dark (issue #49).
   * A switch next to the theme rather than a fourth theme, so it composes
   * with "system": the OS still decides light or dark, this only decides
   * what the document looks like when the answer is dark. No effect in the
   * light theme, where the page is light anyway.
   */
  paperSurface: boolean;
  setPaperSurface: (enabled: boolean) => void;
  /**
   * How wide a table sits in the document. "full" keeps it flush with the
   * text on both sides, "content" shrinks it to what its cells need, so a
   * two-column table stays narrow (issue #59). Either way the columns
   * themselves are sized by their content, never split into equal shares,
   * and a table too wide for the surface scrolls in its wrapper instead of
   * squeezing its columns. No effect on a table whose columns were dragged:
   * those widths are stored on the cells and win over both.
   */
  tableWidth: TableWidth;
  setTableWidth: (width: TableWidth) => void;
  /**
   * Paper size of every paged output: PDF, direct print, DOCX and ODT
   * (lib/pageSetup.ts). App-wide rather than per note, and not overridable in
   * the export dialog, so the PDF, the print and the page lines agree.
   * Starts from the region of the system language.
   */
  pageSize: PageSizeId;
  setPageSize: (size: PageSizeId) => void;
  /** Margin preset (Normal, Narrow, Wide) that goes with pageSize. */
  pageMargins: PageMarginId;
  setPageMargins: (margins: PageMarginId) => void;
  /**
   * Folder notes (see lib/folderNotes.ts): clicking a folder's name opens the
   * folder's own note. Controls only what the tree offers — the note files
   * themselves stay on disk, in the search and in the history whether this
   * is on or off, so switching it off never loses anything. Per vault like
   * headingNumbering (.scribedog/folder-notes.json), loaded by the same call.
   */
  folderNotesEnabled: boolean;
  setFolderNotesEnabled: (enabled: boolean) => void;
  /** Details sidebar next to the document, toggled from the toolbar. */
  detailsPanelVisible: boolean;
  setDetailsPanelVisible: (visible: boolean) => void;
  /**
   * The details panel as a sheet on phone and tablet. Deliberately separate
   * from detailsPanelVisible and not persisted: a panel left docked on the
   * desktop must not come up as a sheet over every note opened on a phone.
   */
  detailsSheetOpen: boolean;
  setDetailsSheetOpen: (open: boolean) => void;
  /** Deepest heading level the details panel's outline lists, 1..6. */
  outlineMaxDepth: number;
  setOutlineMaxDepth: (depth: number) => void;
  /**
   * Automatic "1.2." numbering of headings, shared by the editor, the outline
   * and every export; computed from structure, never written into the note.
   * Unlike the rest of this store it belongs to the open vault
   * (.scribedog/heading-numbering.json, see lib/vaultMeta), so it is the
   * defaults while no vault is open and reloads with every vault switch.
   */
  headingNumbering: HeadingNumberingSettings;
  /** Vault the current headingNumbering and folderNotesEnabled were read from; writes go there. */
  headingNumberingVaultPath: string | null;
  /** Loads every per-vault setting of this store (heading numbering, folder notes). */
  loadHeadingNumbering: (folderPath: string | null) => Promise<void>;
  setHeadingNumbering: (patch: Partial<HeadingNumberingSettings>) => void;
  /** Sections of the details panel the user folded away; app-wide like the panel itself. */
  collapsedDetailsSections: DetailsSectionId[];
  setDetailsSectionCollapsed: (id: DetailsSectionId, collapsed: boolean) => void;
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
  zenWidth: number;
  setZenWidth: (width: number) => void;
  /**
   * Width of the page inside the editor card, in em of the document text
   * (lib/editor/pageWidth.ts), pulled narrower at its edges. `null` is the
   * docked page, as wide as the card. App-wide, like the Zen width.
   */
  pageWidthEm: number | null;
  setPageWidthEm: (widthEm: number | null) => void;
  /**
   * Text size for Zen mode only, set by pinching or Ctrl+wheel there. `null`
   * until the first gesture: the column then follows fontSizePt, so a user
   * who never zooms sees the same text as in the normal view. Kept apart
   * from fontSizePt because that size travels into every export, and a
   * reading size chosen on the couch must not resize the printed page.
   */
  zenFontSizePt: number | null;
  setZenFontSizePt: (sizePt: number | null) => void;
  /**
   * Text size of the normal editor's view, set by Ctrl+wheel over it
   * (useFontZoom). `null` follows fontSizePt; moving the settings slider
   * returns to it. Apart from fontSizePt for the reason the Zen size is:
   * a size picked to read must not resize the exported page.
   */
  viewFontSizePt: number | null;
  setViewFontSizePt: (sizePt: number | null) => void;
};

// Two custom properties drive every editing surface (normal view, Zen mode,
// print), the same way useThemeStore drives the colour scheme.
function applyDocumentFont(fontId: AppFontId): void {
  document.documentElement.style.setProperty(
    "--font-document",
    getFontDefinition(fontId).cssStack
  );
}

function applyDocumentFontScale(sizePt: number): void {
  document.documentElement.style.setProperty(
    "--document-font-scale",
    String(getFontScale(sizePt))
  );
}

const initialFontId = getStoredFontId();
const initialFontSizePt = getStoredFontSizePt();

// The stored family has to be in the document before the editor paints, or the
// first frame renders in the fallback face and visibly reflows.
void ensureFontStylesLoaded(initialFontId);
applyDocumentFont(initialFontId);
applyDocumentFontScale(initialFontSizePt);

export const useEditorSettingsStore = create<EditorSettingsState>((set, get) => ({
  spellcheckEnabled: getStoredSpellcheckEnabled(),
  setSpellcheckEnabled: (enabled: boolean) => {
    persistSpellcheckEnabled(enabled);
    set({ spellcheckEnabled: enabled });
  },
  pageLinesEnabled: getStoredPageLinesEnabled(),
  setPageLinesEnabled: (enabled: boolean) => {
    persistPageLinesEnabled(enabled);
    set({ pageLinesEnabled: enabled });
  },
  autoSaveEnabled: getStoredAutoSaveEnabled(),
  setAutoSaveEnabled: (enabled: boolean) => {
    persistAutoSaveEnabled(enabled);
    set({ autoSaveEnabled: enabled });
  },
  restoreWorkingSet: getStoredRestoreWorkingSet(),
  setRestoreWorkingSet: (enabled: boolean) => {
    persistRestoreWorkingSet(enabled);
    set({ restoreWorkingSet: enabled });
  },
  autoAdmitWorkingSet: getStoredAutoAdmitWorkingSet(),
  setAutoAdmitWorkingSet: (enabled: boolean) => {
    persistAutoAdmitWorkingSet(enabled);
    set({ autoAdmitWorkingSet: enabled });
  },
  openOnDoubleClick: getStoredOpenOnDoubleClick(),
  setOpenOnDoubleClick: (enabled: boolean) => {
    persistOpenOnDoubleClick(enabled);
    set({ openOnDoubleClick: enabled });
  },
  pasteMarkdown: getStoredPasteMarkdown(),
  setPasteMarkdown: (enabled: boolean) => {
    persistPasteMarkdown(enabled);
    set({ pasteMarkdown: enabled });
  },
  aiFeaturesVisible: getStoredAiFeaturesVisible(),
  setAiFeaturesVisible: (visible: boolean) => {
    persistAiFeaturesVisible(visible);
    set({ aiFeaturesVisible: visible });
  },
  reopenLastNote: getStoredReopenLastNote(),
  setReopenLastNote: (enabled: boolean) => {
    persistReopenLastNote(enabled);
    set({ reopenLastNote: enabled });
  },
  fontId: initialFontId,
  setFontId: (fontId: AppFontId) => {
    persistFontId(fontId);
    set({ fontId });
    applyDocumentFont(fontId);
    void ensureFontStylesLoaded(fontId);
  },
  fontSizePt: initialFontSizePt,
  setFontSizePt: (sizePt: number) => {
    const clamped = clampFontSizePt(sizePt);
    persistFontSizePt(clamped);
    // Choosing the document size is also the way back from a zoomed view.
    persistZoomFontSizePt(VIEW_FONT_SIZE_STORAGE_KEY, null);
    set({ fontSizePt: clamped, viewFontSizePt: null });
    applyDocumentFontScale(clamped);
  },
  paperSurface: getStoredPaperSurface(),
  setPaperSurface: (enabled: boolean) => {
    persistPaperSurface(enabled);
    set({ paperSurface: enabled });
  },
  tableWidth: getStoredTableWidth(),
  setTableWidth: (width: TableWidth) => {
    persistTableWidth(width);
    set({ tableWidth: width });
  },
  pageSize: getStoredPageSize(),
  setPageSize: (size: PageSizeId) => {
    persistPageSize(size);
    set({ pageSize: size });
  },
  pageMargins: getStoredPageMargins(),
  setPageMargins: (margins: PageMarginId) => {
    persistPageMargins(margins);
    set({ pageMargins: margins });
  },
  folderNotesEnabled: false,
  setFolderNotesEnabled: (enabled: boolean) => {
    const vaultPath = get().headingNumberingVaultPath;
    set({ folderNotesEnabled: enabled });

    if (vaultPath) {
      writeFolderNotesEnabled(vaultPath, enabled).catch((error: unknown) => {
        console.error("Failed to save folder notes setting:", error);
      });
    }
  },
  detailsPanelVisible: getStoredDetailsPanelVisible(),
  setDetailsPanelVisible: (visible: boolean) => {
    persistDetailsPanelVisible(visible);
    set({ detailsPanelVisible: visible });
  },
  detailsSheetOpen: false,
  setDetailsSheetOpen: (open: boolean) => set({ detailsSheetOpen: open }),
  outlineMaxDepth: getStoredOutlineMaxDepth(),
  setOutlineMaxDepth: (depth: number) => {
    const clamped = clampOutlineDepth(depth);
    persistOutlineMaxDepth(clamped);
    set({ outlineMaxDepth: clamped });
  },
  headingNumbering: DEFAULT_HEADING_NUMBERING,
  headingNumberingVaultPath: null,
  loadHeadingNumbering: async (folderPath: string | null) => {
    // The path is recorded before the read so a change made while it is in
    // flight lands in the right vault, and a read that comes back after the
    // vault has changed again is dropped.
    set({
      headingNumberingVaultPath: folderPath,
      headingNumbering: DEFAULT_HEADING_NUMBERING,
      folderNotesEnabled: false
    });

    if (!folderPath) {
      return;
    }

    const [settings, folderNotesEnabled] = await Promise.all([
      readHeadingNumbering(folderPath),
      readFolderNotesEnabled(folderPath)
    ]);

    if (get().headingNumberingVaultPath === folderPath) {
      set({ headingNumbering: settings, folderNotesEnabled });
    }
  },
  setHeadingNumbering: (patch: Partial<HeadingNumberingSettings>) => {
    const state = get();
    const next = normalizeHeadingNumberingSettings({ ...state.headingNumbering, ...patch });
    set({ headingNumbering: next });

    if (state.headingNumberingVaultPath) {
      writeHeadingNumbering(state.headingNumberingVaultPath, next).catch((error: unknown) => {
        console.error("Failed to save heading numbering:", error);
      });
    }
  },
  collapsedDetailsSections: getStoredCollapsedDetailsSections(),
  setDetailsSectionCollapsed: (id: DetailsSectionId, collapsed: boolean) => {
    set((state) => {
      const without = state.collapsedDetailsSections.filter((current) => current !== id);
      const next = collapsed ? [...without, id] : without;
      persistCollapsedDetailsSections(next);
      return { collapsedDetailsSections: next };
    });
  },
  zoomLevel: getStoredZoomLevel(),
  setZoomLevel: (level: number) => {
    const clamped = clampZoomLevel(level);
    persistZoomLevel(clamped);
    set({ zoomLevel: clamped });
  },
  zenWidth: getStoredZenWidth(),
  setZenWidth: (width: number) => {
    const clamped = clampZenWidth(width);
    persistZenWidth(clamped);
    set({ zenWidth: clamped });
  },
  pageWidthEm: getStoredPageWidthEm(),
  setPageWidthEm: (widthEm: number | null) => {
    const clamped = widthEm === null ? null : clampPageWidthEm(widthEm);
    persistPageWidthEm(clamped);
    set({ pageWidthEm: clamped });
  },
  zenFontSizePt: getStoredZoomFontSizePt(ZEN_FONT_SIZE_STORAGE_KEY),
  setZenFontSizePt: (sizePt: number | null) => {
    const clamped = sizePt === null ? null : clampZenFontSizePt(sizePt);
    persistZoomFontSizePt(ZEN_FONT_SIZE_STORAGE_KEY, clamped);
    set({ zenFontSizePt: clamped });
  },
  viewFontSizePt: getStoredZoomFontSizePt(VIEW_FONT_SIZE_STORAGE_KEY),
  setViewFontSizePt: (sizePt: number | null) => {
    const clamped = sizePt === null ? null : clampZenFontSizePt(sizePt);
    persistZoomFontSizePt(VIEW_FONT_SIZE_STORAGE_KEY, clamped);
    set({ viewFontSizePt: clamped });
  }
}));

// See workingSetSlice.ts for why this is registered rather than imported there.
setRestoreWorkingSetProvider(() => useEditorSettingsStore.getState().restoreWorkingSet);
setAutoAdmitWorkingSetProvider(() => useEditorSettingsStore.getState().autoAdmitWorkingSet);
