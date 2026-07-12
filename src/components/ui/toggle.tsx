import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToggleProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pressed: boolean;
  children: ReactNode;
};

export function Toggle({ pressed, className, children, ...props }: ToggleProps) {
  return (
    <Button
      type="button"
      variant={pressed ? "secondary" : "outline"}
      size="icon-sm"
      aria-pressed={pressed}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      className={cn("editor-toolbar__button", className)}
      {...props}
    >
      {children}
    </Button>
  );
}