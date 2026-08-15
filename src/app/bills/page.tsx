import { requireUser } from "@/lib/require-user";

export default async function BillsPage() {
  await requireUser();
  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Bills</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in Phase 3.</p>
    </main>
  );
}
