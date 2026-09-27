import type { ComponentProps } from "react"
import { Check } from "lucide-react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"

function Menu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="menu" {...props} />
}

function MenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />
}

function MenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="menu-portal" {...props} />
}

function MenuPositioner({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: MenuPrimitive.Positioner.Props) {
  return (
    <MenuPrimitive.Positioner
      data-slot="menu-positioner"
      side={side}
      sideOffset={sideOffset}
      align={align}
      alignOffset={alignOffset}
      className={cn("isolate z-50", className)}
      {...props}
    />
  )
}

function MenuPopup({ className, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Popup
      data-slot="menu-popup"
      className={cn(
        "z-50 min-w-40 origin-(--transform-origin) rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className
      )}
      {...props}
    />
  )
}

function MenuItem({ className, closeOnClick = true, children, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      closeOnClick={closeOnClick}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
    </MenuPrimitive.Item>
  )
}

function MenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />
}

function MenuRadioItem({
  className,
  closeOnClick = true,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="menu-radio-item"
      closeOnClick={closeOnClick}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function MenuRadioItemIndicator({
  className,
  children,
  ...props
}: MenuPrimitive.RadioItemIndicator.Props) {
  return (
    <MenuPrimitive.RadioItemIndicator
      data-slot="menu-radio-item-indicator"
      className={cn("ml-auto flex size-4 items-center justify-center", className)}
      {...props}
    >
      {children ?? <Check className="size-4" />}
    </MenuPrimitive.RadioItemIndicator>
  )
}

function MenuCheckboxItem({
  className,
  closeOnClick = true,
  children,
  ...props
}: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="menu-checkbox-item"
      closeOnClick={closeOnClick}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function MenuCheckboxItemIndicator({
  className,
  children,
  ...props
}: MenuPrimitive.CheckboxItemIndicator.Props) {
  // Drawn first in the row (order-first), in the column where the other
  // items of the menu have their icon: the state reads before the text, the
  // texts line up, and the shortcuts keep the right edge. Kept in place while
  // unchecked, so the text does not move when the item is ticked.
  return (
    <MenuPrimitive.CheckboxItemIndicator
      data-slot="menu-checkbox-item-indicator"
      keepMounted
      className={cn("order-first flex size-4 shrink-0 items-center justify-center data-unchecked:invisible", className)}
      {...props}
    >
      {children ?? <Check className="size-4" />}
    </MenuPrimitive.CheckboxItemIndicator>
  )
}

/** The key combination of a menu item, on its right edge. */
function MenuShortcut({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="menu-shortcut"
      className={cn("ml-auto pl-6 font-sans text-xs tracking-wide opacity-60", className)}
      {...props}
    />
  )
}

export {
  Menu,
  MenuShortcut,
  MenuTrigger,
  MenuPortal,
  MenuPositioner,
  MenuPopup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator
}
