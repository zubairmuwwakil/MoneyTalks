import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CardForm } from "@/components/card-form";
import { catalogueChoices } from "@/lib/cards/catalogueCard";
import { requireUserId } from "@/lib/require-user";

export default async function NewCardPage() {
  await requireUserId();

  return (
    <main className="max-w-6xl mx-auto space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href="/cards"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Wallet</span>
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Add Card</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose your card from our verified catalogue to instantly unlock real-time reward multipliers, fee schedules, and perk tracking.
        </p>
      </div>

      <div className="mt-6">
        <CardForm mode="create" choices={catalogueChoices()} />
      </div>
    </main>
  );
}

