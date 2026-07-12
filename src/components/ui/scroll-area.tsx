import * as React from "react";

import { cn } from "@/lib/utils";

type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement>;

export function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <div className={cn("scroll-area", className)} {...props}>
      {children}
    </div>
  );
}