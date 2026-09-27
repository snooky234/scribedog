import { Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { PinToggleAction } from "@/store/appStore/workingSet";

/**
 * The pin of a note in the tree and in the "In progress" list: the same
 * glyph in both, so a pinned note reads alike, and the way to set or take
 * away the pin without opening the note. On a pinned row it always shows,
 * on the others only while the row is hovered (file-tree.css);
 * hovering the pin of a pinned note shows the pin-off it would do. A span,
 * not a button, for the chevron's reason: both rows are buttons already.
 * The keyboard has Shift+Enter on the row instead.
 */
export function PinToggle({
  action,
  labelKeys,
  onToggle
}: {
  action: PinToggleAction;
  /** What the tooltip calls each action; the list says less than the tree. */
  labelKeys: Record<PinToggleAction, string>;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const pinned = action !== "pin";
  const title = `${t(labelKeys[action])} (${t("common.keys.shift")}+${t("common.keys.enter")})`;

  return (
    <span
      className={cn("pin-toggle", pinned && "pin-toggle--pinned")}
      title={title}
      data-testid="row-pin"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      // Two quick clicks on the pin are two toggles, not the row's double-click.
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {pinned ? (
        <>
          <Pin className="pin-toggle__glyph" aria-label={t("workingSet.pinned")} />
          <PinOff className="pin-toggle__glyph pin-toggle__glyph--hover" aria-hidden="true" />
        </>
      ) : (
        <Pin className="pin-toggle__glyph" aria-hidden="true" />
      )}
    </span>
  );
}
