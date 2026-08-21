import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUserId } from "@/lib/require-user";
import { NewAccountForm } from "@/components/investments/new-account-form";

export default async function NewAccountPage() {
  await requireUserId();

  return (
    <main className="max-w-2xl space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href="/investments"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Investments</span>
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Add account</h1>
        <p className="text-sm text-muted-foreground">
          Create a registered, cash, crypto, or brokerage account with smart presets and compliance checks.
        </p>
      </div>

      <NewAccountForm />
    </main>
  );
}

