"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function SortSelect({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      name="sort"
      defaultValue={defaultValue}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("sort", e.target.value);
        params.delete("page");
        router.push(`/purchases?${params.toString()}`);
      }}
      aria-label="Sort purchases"
      className="rounded-xl border border-input bg-background px-3 py-2 text-xs font-medium text-foreground focus:border-primary focus:ring-2 focus:ring-ring/20 outline-none transition"
    >
      <option value="date_desc">Newest First</option>
      <option value="date_asc">Oldest First</option>
      <option value="amount_desc">Highest Amount</option>
      <option value="amount_asc">Lowest Amount</option>
    </select>
  );
}
