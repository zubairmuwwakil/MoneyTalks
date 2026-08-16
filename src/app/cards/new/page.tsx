import { CardForm } from "@/components/card-form";
import { requireUserId } from "@/lib/require-user";

export default async function NewCardPage() {
  await requireUserId();

  return (
    <main className="max-w-3xl py-8">
      <h1 className="text-xl font-semibold">Add card</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Add the rewards you actually receive so recommendations and fee verdicts stay useful.
      </p>
      <div className="mt-6">
        <CardForm mode="create" />
      </div>
    </main>
  );
}
