import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow-xs",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive/15 text-destructive font-semibold",
        outline: "text-foreground border border-border",
        success: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-semibold",
        warning: "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300 font-semibold",
        info: "border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300 font-medium",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
      size: {
        default: "text-xs px-2 py-0.5",
        sm: "text-[10px] px-1.5 py-0.2",
        lg: "text-sm px-2.5 py-1",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
