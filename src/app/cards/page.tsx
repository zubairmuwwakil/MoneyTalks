import { requireUser } from "@/lib/require-user";

export default async function CardsPage() {
  await requireUser();
  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Cards</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in Phase 4.</p>
    </main>
  );
}
