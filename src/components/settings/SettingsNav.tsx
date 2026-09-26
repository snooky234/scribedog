import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  getSettingsTabOrder,
  getVisibleSettingsNav,
  SETTINGS_GROUP_LABEL_KEY,
  SETTINGS_TAB_LABEL_KEY,
  type SettingsTab
} from "@/components/settings/settingsTabs";
import { getFolderBasename } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

type SettingsNavProps = {
  activeTab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
};

export function settingsTabId(tab: SettingsTab): string {
  return `settings-tab-${tab}`;
}

export function settingsPanelId(tab: SettingsTab): string {
  return `settings-panel-${tab}`;
}

/**
 * The navigation column: the available entries in three groups. A vertical tablist,
 * so the arrow keys move between the entries and Tab leaves the column for
 * the content — the entry that is active is the only one in the tab order.
 */
export function SettingsNav({ activeTab, onSelect }: SettingsNavProps) {
  const { t } = useTranslation();
  const folderPath = useAppStore((state) => state.folderPath);
  const aiFeaturesVisible = useEditorSettingsStore((state) => state.aiFeaturesVisible);
  const buttonRefs = useRef(new Map<SettingsTab, HTMLButtonElement>());
  const visibleNav = getVisibleSettingsNav(aiFeaturesVisible);
  const tabOrder = getSettingsTabOrder(aiFeaturesVisible);

  // In a narrow window the column is a strip that scrolls sideways, and the
  // entry that is open can sit outside it — on opening the dialog on the last
  // one, or after a click, which unlike the arrow keys moves no focus.
  useEffect(() => {
    buttonRefs.current.get(activeTab)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  const moveTo = (tab: SettingsTab) => {
    onSelect(tab);
    buttonRefs.current.get(tab)?.focus();
  };

  // Both axes, since the column becomes a strip in a narrow window.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabOrder.indexOf(activeTab);
    const last = tabOrder.length - 1;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        moveTo(tabOrder[index >= last ? 0 : index + 1]);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        moveTo(tabOrder[index <= 0 ? last : index - 1]);
        break;
      case "Home":
        moveTo(tabOrder[0]);
        break;
      case "End":
        moveTo(tabOrder[last]);
        break;
      default:
        return;
    }

    event.preventDefault();
  };

  return (
    <div
      className="settings-nav"
      role="tablist"
      aria-orientation="vertical"
      aria-label={t("settingsDialog.tabsAriaLabel")}
      onKeyDown={handleKeyDown}
    >
      {visibleNav.map(({ group, tabs }) => (
        <div key={group} className="settings-nav__group" role="presentation">
          <span className="settings-nav__group-title" aria-hidden="true">
            {t(SETTINGS_GROUP_LABEL_KEY[group])}
          </span>
          {tabs.map((tab) => {
            const isActive = tab === activeTab;
            // The folder entry names the folder it stands for: "open folder"
            // alone leaves the question which one that is.
            const subtitle =
              tab === "vault"
                ? folderPath === null
                  ? t("settingsDialog.vaultNavNoFolder")
                  : getFolderBasename(folderPath)
                : null;

            return (
              <button
                key={tab}
                ref={(element) => {
                  if (element) {
                    buttonRefs.current.set(tab, element);
                  } else {
                    buttonRefs.current.delete(tab);
                  }
                }}
                type="button"
                role="tab"
                id={settingsTabId(tab)}
                data-testid={settingsTabId(tab)}
                aria-selected={isActive}
                aria-controls={settingsPanelId(tab)}
                tabIndex={isActive ? 0 : -1}
                className={isActive ? "settings-nav__item settings-nav__item--active" : "settings-nav__item"}
                onClick={() => onSelect(tab)}
              >
                <span className="settings-nav__item-label">{t(SETTINGS_TAB_LABEL_KEY[tab])}</span>
                {subtitle ? (
                  <span className="settings-nav__item-sub" title={subtitle}>
                    {subtitle}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
