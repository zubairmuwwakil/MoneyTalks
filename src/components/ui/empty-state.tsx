import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 p-8 text-center",
        className
      )}
    >
      {Icon ? (
        <div className="mb-3.5 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground ring-4 ring-background">
          <Icon className="size-6" />
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-foreground tracking-tight">{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs sm:text-sm text-muted-foreground">{description}</p>
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {action?.href ? (
            <Button asChild size="sm">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : action?.onClick ? (
            <Button size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}

          {secondaryAction?.href ? (
            <Button asChild variant="outline" size="sm">
              <Link href={secondaryAction.href}>{secondaryAction.label}</Link>
            </Button>
          ) : secondaryAction?.onClick ? (
            <Button variant="outline" size="sm" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
