import { create } from "zustand";

import {
  importFontFiles,
  loadCustomFonts,
  removeCustomFont,
  type FontImportFile,
  type FontImportReport
} from "@/lib/customFonts";
import { setCustomFonts, type CustomFontDefinition, type CustomFontId } from "@/lib/fonts";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

/**
 * The fonts imported into the open vault (lib/customFonts.ts). The module
 * registry in lib/fonts.ts is what the exports read; this store is what the
 * settings dialog renders, and it keeps the two in step.
 */
type CustomFontsState = {
  /** Vault the list belongs to; a late answer for another vault is dropped. */
  vaultPath: string | null;
  fonts: CustomFontDefinition[];
  load: (folderPath: string | null) => Promise<void>;
  importFiles: (files: FontImportFile[]) => Promise<FontImportReport | null>;
  remove: (id: CustomFontId) => Promise<void>;
};

export const useCustomFontsStore = create<CustomFontsState>((set, get) => {
  const publish = (vaultPath: string | null, fonts: CustomFontDefinition[]) => {
    setCustomFonts(fonts);
    set({ vaultPath, fonts });
    useEditorSettingsStore.getState().reapplyDocumentFont();
  };

  return {
    vaultPath: null,
    fonts: [],
    load: async (folderPath) => {
      publish(folderPath, []);

      if (!folderPath) {
        return;
      }

      const fonts = await loadCustomFonts(folderPath);

      if (get().vaultPath === folderPath) {
        publish(folderPath, fonts);
      }
    },
    importFiles: async (files) => {
      const folderPath = get().vaultPath;

      if (!folderPath) {
        return null;
      }

      const report = await importFontFiles(folderPath, files);
      const fonts = await loadCustomFonts(folderPath);

      if (get().vaultPath === folderPath) {
        publish(folderPath, fonts);
      }

      return report;
    },
    remove: async (id) => {
      const folderPath = get().vaultPath;

      if (!folderPath) {
        return;
      }

      await removeCustomFont(folderPath, id);
      const fonts = await loadCustomFonts(folderPath);

      if (get().vaultPath === folderPath) {
        publish(folderPath, fonts);
      }
    }
  };
});
