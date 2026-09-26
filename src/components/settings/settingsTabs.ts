import { platform } from "@/platform";
import type { PlatformFeatures } from "@/platform/types";

export type SettingsTab =
  | "application"
  | "appearance"
  | "fonts"
  | "shortcuts"
  | "ai"
  | "assistants"
  | "rag"
  | "versioning"
  | "vault"
  | "account"
  | "server";

export type SettingsGroup = "application" | "ai" | "folder";

/**
 * The navigation column, in this order. "application" comes first so the
 * language stays where people look for it; the folder group is last because
 * its entries change meaning with the open folder.
 */
export const SETTINGS_NAV: { group: SettingsGroup; tabs: SettingsTab[] }[] = [
  { group: "application", tabs: ["application", "appearance", "fonts", "shortcuts", "account", "server"] },
  { group: "ai", tabs: ["ai", "assistants", "rag"] },
  { group: "folder", tabs: ["versioning", "vault"] }
];

/**
 * Entries that stand on a capability the shell may not have. The knowledge
 * base reads its index from disk, so the browser has no entry for it at all;
 * the account entry only exists where there is a login to change.
 * Filtering here rather than in the navigation keeps the arrow keys from
 * landing on an entry that is not on screen.
 */
const SETTINGS_TAB_FEATURE: Partial<Record<SettingsTab, keyof PlatformFeatures>> = {
  rag: "knowledgeIndex",
  account: "session",
  server: "remoteVaults"
};

export function isSettingsTabAvailable(tab: SettingsTab): boolean {
  const feature = SETTINGS_TAB_FEATURE[tab];

  return feature === undefined || platform.features[feature];
}

/** The pages the "show AI features" switch in the application settings hides. */
export const AI_SETTINGS_TABS: SettingsTab[] = ["ai", "assistants", "rag"];

export function getVisibleSettingsNav(aiFeaturesVisible: boolean): { group: SettingsGroup; tabs: SettingsTab[] }[] {
  return SETTINGS_NAV.map(({ group, tabs }) => ({
    group,
    tabs: tabs.filter(
      (tab) => isSettingsTabAvailable(tab) && (aiFeaturesVisible || !AI_SETTINGS_TABS.includes(tab))
    )
  })).filter(({ tabs }) => tabs.length > 0);
}

export function getSettingsTabOrder(aiFeaturesVisible: boolean): SettingsTab[] {
  return getVisibleSettingsNav(aiFeaturesVisible).flatMap((group) => group.tabs);
}

/**
 * Tabs whose settings apply through their own store the moment they change.
 * The Save button belongs to the AI settings draft; on these tabs it would
 * only mislead — on the knowledge base tab it would even look like the button
 * that applies its connection.
 */
export const SELF_SAVING_TABS: SettingsTab[] = [
  "fonts",
  "shortcuts",
  "assistants",
  "rag",
  "versioning",
  "vault",
  "account",
  "server"
];

export const SETTINGS_TAB_LABEL_KEY: Record<SettingsTab, string> = {
  application: "settingsDialog.tabApplication",
  appearance: "settingsDialog.tabAppearance",
  fonts: "settingsDialog.tabFonts",
  shortcuts: "settingsDialog.tabShortcuts",
  ai: "settingsDialog.tabAi",
  assistants: "settingsDialog.tabAssistants",
  rag: "settingsDialog.tabRag",
  versioning: "settingsDialog.tabVersioning",
  vault: "settingsDialog.tabVault",
  account: "settingsDialog.tabAccount",
  server: "settingsDialog.tabServer"
};

export const SETTINGS_GROUP_LABEL_KEY: Record<SettingsGroup, string> = {
  application: "settingsDialog.groupApplication",
  ai: "settingsDialog.groupAi",
  folder: "settingsDialog.groupFolder"
};
