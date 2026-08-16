import * as React from "react";
import { cn } from "@/lib/utils";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-xs font-medium leading-none text-foreground/90 peer-disabled:cursor-not-allowed peer-disabled:opacity-70 select-none flex items-center gap-1",
        className
      )}
      {...props}
    >
      {children}
      {required ? <span className="text-destructive text-xs leading-none">*</span> : null}
    </label>
  )
);
Label.displayName = "Label";

export { Label };
