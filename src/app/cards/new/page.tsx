import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CardForm } from "@/components/card-form";
import { catalogueChoices } from "@/lib/cards/catalogueCard";
import { getOrCreateProfile } from "@/lib/profile";
import { requireUserId } from "@/lib/require-user";

export default async function NewCardPage() {
  const userId = await requireUserId();
  const profile = await getOrCreateProfile(userId);

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
          Browse cards for your selected market. Entries not yet confirmed against their issuer are clearly marked and never used for recommendations.
        </p>
      </div>

      <div className="mt-6">
        <CardForm mode="create" choices={catalogueChoices()} initialMarket={profile.cardShoppingMarket} />
      </div>
    </main>
  );
}
