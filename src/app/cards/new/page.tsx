import Link from "next/link";
import { ArrowLeft, CreditCard } from "lucide-react";
import { CardForm } from "@/components/card-form";
import { requireUserId } from "@/lib/require-user";

export default async function NewCardPage() {
  await requireUserId();

  return (
    <main className="max-w-3xl space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href="/cards"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Wallet</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Add card</h1>
        <p className="text-sm text-muted-foreground">
          Configure rewards, category multipliers, and conditions to maximize points and net value.
        </p>
      </div>

      <div className="mt-6">
        <CardForm mode="create" />
      </div>
    </main>
  );
}
