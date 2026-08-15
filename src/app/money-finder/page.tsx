import { requireUser } from "@/lib/require-user";

export default async function MoneyFinderPage() {
  await requireUser();
  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Money Finder</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in Phase 2.</p>
    </main>
  );
}
