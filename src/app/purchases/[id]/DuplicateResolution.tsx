"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { mergeDuplicatePurchase, keepSeparatePurchase } from "./actions";

export default function DuplicateResolution({ purchaseId }: { purchaseId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          className="border-amber-400/60 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700/50"
          onClick={() =>
            startTransition(async () => {
              const result = await mergeDuplicatePurchase(purchaseId);
              if (result && !result.ok) setError(result.error);
            })
          }
        >
          {pending ? "Merging..." : "Same purchase — merge"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          className="text-amber-800 hover:bg-amber-200/50 dark:text-amber-300 dark:hover:bg-amber-900/40"
          onClick={() =>
            startTransition(async () => {
              const result = await keepSeparatePurchase(purchaseId);
              if (!result.ok) setError(result.error);
              else router.refresh();
            })
          }
        >
          Different — keep separate
        </Button>
      </div>
      {error ? <div className="mt-1 text-xs text-red-600 dark:text-red-400 font-medium">{error}</div> : null}
    </div>
  );
}

