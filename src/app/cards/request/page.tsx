import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUserId } from "@/lib/require-user";
import { CardRequestForm } from "./CardRequestForm";

export default async function RequestCardPage() {
  await requireUserId();

  return (
    <main className="max-w-2xl space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href="/cards/new"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Add card</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Request a card</h1>
        <p className="text-sm text-muted-foreground">
          Cards are added once their earn rates, caps and fees have been confirmed against the
          issuer&apos;s own terms — that&apos;s why you can&apos;t type them in yourself, and why the
          numbers you do see can be trusted. Tell us which card you hold and it goes on the list.
        </p>
      </div>

      <CardRequestForm />
    </main>
  );
}
