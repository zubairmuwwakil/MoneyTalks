import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CreditCard, LockKeyhole, ReceiptText, Smartphone } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { listIncompleteCaptureEvidence } from "@/lib/domain/wallet/incompleteCapture";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RecoveryForm, type RecoveryCardOption } from "./RecoveryForm";

export const metadata: Metadata = {
  title: "Recover Wallet captures",
  description: "Correct incomplete Apple Wallet captures and turn them into purchases.",
};

const MISSING_LABELS = {
  merchant: "Merchant",
  amount: "Amount",
  currency: "Currency",
  card: "Card label",
} as const;

function formatCapturedAt(value: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}

export default async function WalletCaptureRecoveryPage() {
  const userId = await requireUserId();
  const [captures, cards, preference] = await Promise.all([
    listIncompleteCaptureEvidence(userId),
    prisma.creditCard.findMany({
      where: { userId, contractCardId: { not: null } },
      select: { nickname: true, issuer: true, lastFour: true, contractCardId: true },
      orderBy: { nickname: "asc" },
    }),
    prisma.notificationPreference.findUnique({
      where: { userId },
      select: { timezone: true },
    }),
  ]);

  const cardOptions: RecoveryCardOption[] = cards.flatMap((card) => card.contractCardId
    ? [{
        id: card.contractCardId,
        label: `${card.nickname}${card.lastFour ? ` · •••• ${card.lastFour}` : ""} · ${card.issuer}`,
      }]
    : []);

  return (
    <main className="space-y-6 pb-12 pt-4 sm:pt-6">
      <div className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground">
            <Link href="/purchases"><ArrowLeft className="size-4" />Purchases</Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Incomplete Wallet captures</h1>
            {captures.length > 0 ? <Badge variant="warning">{captures.length} need attention</Badge> : null}
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Add the missing transaction details, then run the same purchase normalization used for new Wallet captures.
          </p>
        </div>
        <div className="flex max-w-sm items-start gap-2 text-xs text-muted-foreground">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p>Only correction hints are shown here. Location, device metadata, diagnostics, and the preserved raw payload stay hidden.</p>
        </div>
      </div>

      {captures.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No captures need recovery"
          description="Incomplete Wallet captures will appear here instead of disappearing from your purchase workflow."
          action={{ label: "Back to purchases", href: "/purchases" }}
        />
      ) : (
        <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xs">
          {captures.map((capture, index) => (
            <article key={capture.id} className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-8">
              <section aria-labelledby={`capture-${capture.id}`} className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      Capture {index + 1}
                    </p>
                    <h2 id={`capture-${capture.id}`} className="mt-0.5 text-sm font-semibold text-foreground">
                      {formatCapturedAt(capture.capturedAt, preference?.timezone ?? null)}
                    </h2>
                  </div>
                  <Badge variant="warning"><AlertTriangle className="size-3" />Incomplete</Badge>
                </div>

                <dl className="space-y-2.5 text-xs">
                  <div className="flex items-start gap-2">
                    <Smartphone className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div><dt className="sr-only">Source</dt><dd>{capture.sourceLabel} · {capture.installationLabel}</dd></div>
                  </div>
                  <div className="grid grid-cols-[5.5rem_1fr] gap-2 border-t border-border/60 pt-2.5">
                    <dt className="text-muted-foreground">Merchant hint</dt>
                    <dd className="break-words font-medium">{capture.merchantHint ?? "Not captured"}</dd>
                  </div>
                  <div className="grid grid-cols-[5.5rem_1fr] gap-2">
                    <dt className="text-muted-foreground">Amount hint</dt>
                    <dd className="break-words font-medium">
                      {capture.amountHint ?? "Not captured"}
                      {capture.amountDisagreement ? <span className="ml-1 text-amber-700 dark:text-amber-400">· conflicting values</span> : null}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[5.5rem_1fr] gap-2">
                    <dt className="text-muted-foreground">Currency hint</dt>
                    <dd className="font-medium">{capture.currencyHint ?? "Not captured"}</dd>
                  </div>
                  <div className="grid grid-cols-[5.5rem_1fr] gap-2">
                    <dt className="text-muted-foreground">Card hint</dt>
                    <dd className="break-words font-medium">{capture.cardHint ?? "Not captured"}</dd>
                  </div>
                </dl>

                {capture.missing.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5" aria-label="Missing capture fields">
                    {capture.missing.map((field) => <Badge key={field} variant="muted">Missing {MISSING_LABELS[field].toLowerCase()}</Badge>)}
                  </div>
                ) : null}
              </section>

              <section className="rounded-xl bg-muted/35 p-4 ring-1 ring-border/60">
                <div className="mb-4 flex items-center gap-2">
                  <CreditCard className="size-4 text-primary" />
                  <div>
                    <h3 className="text-sm font-semibold">Correct and retry</h3>
                    <p className="text-[11px] text-muted-foreground">Required fields create one idempotent Purchase.</p>
                  </div>
                </div>
                <RecoveryForm eventId={capture.id} defaults={capture.defaults} cards={cardOptions} />
              </section>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
