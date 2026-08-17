"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { mergeDuplicatePurchase, keepSeparatePurchase } from "./actions";

export default function DuplicateResolution({ purchaseId }: { purchaseId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        <button
          disabled={pending}
          className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          onClick={() =>
            startTransition(async () => {
              const result = await mergeDuplicatePurchase(purchaseId);
              if (result && !result.ok) setError(result.error);
            })
          }
        >
          Same purchase — merge
        </button>
        <button
          disabled={pending}
          className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          onClick={() =>
            startTransition(async () => {
              const result = await keepSeparatePurchase(purchaseId);
              if (!result.ok) setError(result.error);
              else router.refresh();
            })
          }
        >
          Different — keep separate
        </button>
      </div>
      {error ? <div className="mt-1 text-xs text-red-700">{error}</div> : null}
    </div>
  );
}
