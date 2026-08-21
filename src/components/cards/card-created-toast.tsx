"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/**
 * Reads `?created=1` from the URL, fires a success toast, then strips the
 * param so a page refresh doesn't re-toast. Mount this on the card detail
 * page — it renders nothing visible.
 */
export function CardCreatedToast() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get("created") === "1") {
      toast.success("Card added to your wallet!", {
        description: "Rates and credits from the catalogue are now active.",
      });
      // Strip the param without a full navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("created");
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [searchParams, router]);

  return null;
}
