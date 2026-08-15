import { requireUser } from "@/lib/require-user";

export default async function InvestmentsPage() {
  await requireUser();
  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Investments</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in Phase 1.</p>
    </main>
  );
}
