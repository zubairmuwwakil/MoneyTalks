import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CardForm } from "@/components/card-form";
import { catalogueChoices } from "@/lib/cards/catalogueCard";
import { requireUserId } from "@/lib/require-user";

export default async function NewCardPage() {
  await requireUserId();

  return (
    <main className="max-w-5xl space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href="/cards"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Wallet</span>
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Add card</h1>
        <p className="text-sm text-muted-foreground">
          Pick your card from the shared catalogue — its rates, caps and credits come with it, identical to PickMe — then add the details that are specific to your copy.
        </p>
      </div>

      <div className="mt-6">
        <CardForm mode="create" choices={catalogueChoices()} />
      </div>
    </main>
  );
}
