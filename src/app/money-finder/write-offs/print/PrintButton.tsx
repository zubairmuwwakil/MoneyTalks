"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => window.print()}
      className="gap-1.5 text-xs font-semibold shadow-2xs cursor-pointer"
    >
      <Printer className="size-3.5" />
      <span>Print / Save as PDF</span>
    </Button>
  );
}
