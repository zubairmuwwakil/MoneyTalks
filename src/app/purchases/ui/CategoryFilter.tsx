"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CATEGORIES } from "@/lib/categories";

export function CategoryFilter({
  defaultValue,
}: {
  defaultValue?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      name="category"
      defaultValue={defaultValue ?? "all"}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        const val = e.target.value;
        if (val && val !== "all") {
          params.set("category", val);
        } else {
          params.delete("category");
        }
        params.delete("page");
        const query = params.toString();
        router.push(query ? `/purchases?${query}` : "/purchases");
      }}
      aria-label="Filter by category"
      className="rounded-xl border border-input bg-background px-3 py-2 text-xs font-medium text-foreground focus:border-primary focus:ring-2 focus:ring-ring/20 outline-none transition"
    >
      <option value="all">🏷️ All Categories</option>
      <option value="uncategorized">❓ Uncategorized</option>
      {CATEGORIES.map((cat) => (
        <option key={cat.id} value={cat.id}>
          {cat.icon} {cat.label}
        </option>
      ))}
    </select>
  );
}
