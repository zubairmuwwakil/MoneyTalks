import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  prefixNode?: React.ReactNode;
  suffixNode?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, prefixNode, suffixNode, ...props }, ref) => {
    if (prefixNode || suffixNode) {
      return (
        <div className="relative flex items-center w-full">
          {prefixNode ? (
            <div className="pointer-events-none absolute left-3 flex items-center text-muted-foreground text-xs select-none">
              {prefixNode}
            </div>
          ) : null}
          <input
            type={type}
            className={cn(
              "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50",
              prefixNode ? "pl-7" : "",
              suffixNode ? "pr-7" : "",
              className
            )}
            ref={ref}
            {...props}
          />
          {suffixNode ? (
            <div className="pointer-events-none absolute right-3 flex items-center text-muted-foreground text-xs select-none">
              {suffixNode}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
