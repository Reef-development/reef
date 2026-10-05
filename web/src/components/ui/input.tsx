import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onFocus, onWheel, ...props }, ref) => {
    const isNumber = type === "number";
    return (
      <input
        type={type}
        className={cn(
          "relative flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:z-10 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          isNumber && "num-input",
          className,
        )}
        ref={ref}
        onFocus={(e) => {
          // Tapping a number field selects its contents so typing replaces
          // the existing value instead of appending to a leading "0".
          if (isNumber) requestAnimationFrame(() => e.target.select?.());
          onFocus?.(e);
        }}
        onWheel={(e) => {
          if (isNumber) (e.target as HTMLInputElement).blur();
          onWheel?.(e);
        }}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
