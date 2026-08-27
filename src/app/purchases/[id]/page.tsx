import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CreditCard,
  ExternalLink,
  FileText,
  MapPin,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { InlineCategoryPicker } from "../ui/InlineCategoryPicker";
import { getCategoryMeta } from "@/lib/categories";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils/calendarEvents";
import { requireUserId } from "@/lib/require-user";
import { purchaseLocalDateTime } from "@/lib/utils/purchaseTime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import DuplicateResolution from "./DuplicateResolution";
import { createReturnForPurchase } from "./actions";
import PurchaseCorrections from "./PurchaseCorrections";

function formatSource(source: string) {
  switch (source) {
    case "WALLET":
      return { label: "Apple Wallet", variant: "info" as const };
    case "GMAIL":
    case "EMAIL":
      return { label: "Email Receipt", variant: "success" as const };
    case "UPLOAD":
      return { label: "Manual Upload", variant: "secondary" as const };
    default:
      return { label: source, variant: "outline" as const };
  }
}

export default async function PurchaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const { error } = (await searchParams) ?? {};

  async function submitCreateReturn(formData: FormData) {
    "use server";
    const result = await createReturnForPurchase(formData);
    if (result && !result.ok) {
      redirect(`/purchases/${id}?error=${encodeURIComponent(result.error)}`);
    }
  }

  const purchase = await prisma.purchase.findFirst({
    where: { id, userId },
    include: {
      items: true,
      attachments: true,
      returns: true,
      walletEvents: {
        select: {
          eventId: true,
          capturedAt: true,
          capturedTimezone: true,
          uploadedAt: true,
          merchantRaw: true,
          transactionNameRaw: true,
          cardRaw: true,
          resolvedCardId: true,
          latitude: true,
          longitude: true,
          locationAccuracyMeters: true,
          feedbackVerdict: true,
          feedbackWarning: true,
        },
        orderBy: { capturedAt: "asc" },
      },
      corrections: { where: { undoneAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
      emailTransactions: {
        select: { id: true, fromEmail: true, subject: true, orderId: true, purchasedAt: true, provider: true },
      },
    },
  });

  if (!purchase) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <div className="rounded-2xl border bg-card p-12 text-center text-muted-foreground">
          <p className="text-lg font-semibold">Purchase not found</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/purchases">
              <ArrowLeft className="size-4" /> Back to Purchases
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  const returnItem = purchase.returns[0] ?? null;
  const wallet = purchase.walletEvents[0] ?? null;
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  const homeZone = pref?.timezone ?? null;
  const local = purchaseLocalDateTime(wallet?.capturedAt ?? purchase.purchasedAt, wallet?.capturedTimezone, homeZone);
  const whenFormatted = local.toFormat("cccc, MMMM d, yyyy · h:mm:ss a");
  const timeZoneBadge = local.toFormat("ZZZZ");

  const cards = await prisma.creditCard.findMany({
    where: { userId, contractCardId: { not: null } },
    select: { nickname: true, contractCardId: true },
  });
  const cardName = (contractCardId: string | null) =>
    cards.find((c) => c.contractCardId === contractCardId)?.nickname ?? null;

  const resolvedCardDisplay = wallet
    ? (cardName(wallet.resolvedCardId) ?? wallet.cardRaw ?? "Unknown card")
    : (purchase.paymentMethod ?? "Unknown payment method");

  const sourceMeta = formatSource(purchase.source);

  // Return window calculation (default 30-day policy)
  const returnWindowDays = returnItem?.returnWindowDays ?? 30;
  const purchaseDate = new Date(purchase.purchasedAt);
  const returnDeadline = returnItem?.returnBy ?? new Date(purchaseDate.getTime() + returnWindowDays * 24 * 60 * 60 * 1000);
  const now = new Date();
  const daysRemaining = Math.ceil((returnDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const isReturnActive = daysRemaining >= 0;

  const flaggedTwin = purchase.possibleDuplicateOfId
    ? await prisma.purchase.findFirst({
        where: { id: purchase.possibleDuplicateOfId, userId },
        select: { id: true, merchant: true, totalCents: true, currency: true, purchasedAt: true },
      })
    : null;

  const merchantInitial = (purchase.merchant || "P").trim().charAt(0).toUpperCase();

  return (
    <main className="mx-auto max-w-6xl space-y-6 pb-12">
      {/* Top Breadcrumb & Navigation */}
      <div>
        <Link
          href="/purchases"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Back to Purchases
        </Link>
      </div>

      {/* Hero Header Card */}
      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500/20 via-purple-500/20 to-pink-500/20 border border-border text-xl font-bold text-foreground">
              {merchantInitial}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  {purchase.merchant}
                </h1>
                <Badge variant={sourceMeta.variant} size="sm">
                  {sourceMeta.label}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="size-3.5" />
                  {whenFormatted}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
                  {timeZoneBadge}
                </span>
                {purchase.orderNumber ? (
                  <span className="font-mono text-foreground/80">· Order #{purchase.orderNumber}</span>
                ) : null}
                <span>·</span>
                <InlineCategoryPicker
                  rawString={wallet?.merchantRaw ?? purchase.merchant}
                  currentCategory={purchase.category}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start sm:items-end justify-between border-t border-border/40 pt-3 sm:border-t-0 sm:pt-0">
            {typeof purchase.totalCents === "number" ? (
              <div className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {formatMoney(purchase.totalCents, purchase.currency)}
              </div>
            ) : (
              <div className="text-sm font-medium text-muted-foreground">Amount pending</div>
            )}
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CreditCard className="size-3.5 text-primary/70" />
              <span>{resolvedCardDisplay}</span>
            </div>
          </div>
        </div>

        {/* Dynamic Feedback or Warning alerts */}
        {wallet?.feedbackWarning ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <p className="font-semibold">Rewards Optimization Tip</p>
              <p className="mt-0.5">{wallet.feedbackWarning}</p>
            </div>
          </div>
        ) : null}
      </div>

      {/* Duplicate Resolution Banner if flagged */}
      {flaggedTwin ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">Possible Near-Match Duplicate Found</p>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Matches amount and time with{" "}
                <Link href={`/purchases/${flaggedTwin.id}`} className="font-semibold underline hover:text-amber-950 dark:hover:text-white">
                  {flaggedTwin.merchant} · {formatMoney(flaggedTwin.totalCents ?? undefined, flaggedTwin.currency)}
                </Link>
                , but merchant strings differ.
              </p>
              <DuplicateResolution purchaseId={purchase.id} />
            </div>
          </div>
        </div>
      ) : null}

      {/* 2-Column Responsive Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column (2 spans): Payment Details, Items & Receipts */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Corrections</CardTitle><CardDescription>Raw Wallet evidence is preserved unless you permanently delete it.</CardDescription></CardHeader>
            <CardContent><PurchaseCorrections purchaseId={purchase.id} merchant={purchase.merchant}
              totalCents={purchase.totalCents} currency={purchase.currency} paymentMethod={purchase.paymentMethod}
              financialState={purchase.financialState} canUndo={purchase.corrections.length > 0} /></CardContent>
          </Card>
          {/* Card: Core Details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-foreground">Purchase Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Payment Method
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
                    <CreditCard className="size-4 text-primary" />
                    <span>{resolvedCardDisplay}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Category & Channel
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>{getCategoryMeta(purchase.category).icon}</span>
                    <span>{getCategoryMeta(purchase.category).label}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card: Items Breakdown (if parsed) */}
          {purchase.items.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-foreground">
                    Itemized Items ({purchase.items.length})
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border/60 rounded-xl border border-border/60">
                  {purchase.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-3 text-sm">
                      <div className="space-y-0.5">
                        <p className="font-medium text-foreground">{item.title}</p>
                        {item.qty ? <p className="text-xs text-muted-foreground">Quantity: {item.qty}</p> : null}
                      </div>
                      {typeof item.priceCents === "number" ? (
                        <span className="font-mono text-sm font-semibold text-foreground">
                          {formatMoney(item.priceCents, item.currency)}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Card: Receipts & Attachments */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-foreground">Receipts & Attachments</CardTitle>
                  <CardDescription>Paper receipts, invoices, and confirmation documents.</CardDescription>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/receipts/upload">
                    <UploadCloud className="size-3.5" />
                    Upload Receipt
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {purchase.attachments.length > 0 ? (
                <div className="space-y-2">
                  {purchase.attachments.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between rounded-xl border border-border/70 bg-card p-3 text-sm shadow-2xs hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium text-foreground text-xs">{doc.storageKey}</span>
                      </div>
                      <Button asChild variant="ghost" size="xs">
                        <a href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer">
                          Download
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-6 text-center text-muted-foreground">
                  <FileText className="size-8 text-muted-foreground/50 mb-2" />
                  <p className="text-xs font-medium text-foreground">No paper receipt attached yet</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Upload a receipt photo to attach line items and proof of purchase.
                  </p>
                  <Button asChild variant="outline" size="xs" className="mt-3">
                    <Link href="/receipts/upload">
                      <UploadCloud className="size-3" />
                      Add Receipt Photo
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column (1 span): Return Tracker, Location & Observation Audit */}
        <div className="space-y-6">
          {/* Card: Return & Protection Tracker */}
          <Card className="border-primary/20 bg-linear-to-b from-card via-card to-primary/5">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-foreground">Return & Protection</CardTitle>
                <ShieldCheck className="size-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {returnItem ? (
                <div className="rounded-xl border border-border/80 bg-background/80 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Return Status</span>
                    <Badge variant={returnItem.status === "REFUNDED" ? "success" : "info"} size="sm">
                      {returnItem.status}
                    </Badge>
                  </div>
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <Link href="/returns">View in Returns Hub</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border/80 bg-background/80 p-3.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Standard Window</span>
                      <Badge variant={isReturnActive ? "success" : "muted"} size="sm">
                        {isReturnActive ? `${daysRemaining} days left` : "Window Closed"}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Deadline: {purchaseLocalDateTime(returnDeadline, null, homeZone).toFormat("MMM d, yyyy")}
                    </p>
                  </div>

                  <form action={submitCreateReturn}>
                    <input type="hidden" name="purchaseId" value={purchase.id} />
                    <Button type="submit" variant="default" size="default" className="w-full gap-2">
                      <RotateCcw className="size-3.5" />
                      Start a Return
                    </Button>
                  </form>
                </div>
              )}

              {error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs font-medium text-destructive">
                  {error}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Card: Location Map (when GPS coordinates exist) */}
          {wallet?.latitude != null && wallet?.longitude != null ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-foreground">Store Location</CardTitle>
                  <MapPin className="size-4 text-primary" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center justify-between text-foreground font-medium">
                    <span>GPS Coordinates</span>
                    <span className="font-mono text-[11px]">
                      {wallet.latitude.toFixed(5)}, {wallet.longitude.toFixed(5)}
                    </span>
                  </div>
                  {wallet.locationAccuracyMeters != null ? (
                    <p className="text-[10px] text-muted-foreground">
                      Accuracy: ±{Math.round(wallet.locationAccuracyMeters)} meters
                    </p>
                  ) : null}
                </div>

                <Button asChild variant="outline" size="sm" className="w-full gap-1.5">
                  <a
                    href={`https://maps.apple.com/?ll=${wallet.latitude},${wallet.longitude}&q=${encodeURIComponent(purchase.merchant)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="size-3.5" />
                    Open in Apple Maps
                  </a>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {/* Card: Multi-Source Observations & Audit Trail */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-foreground">Observations Audit</CardTitle>
                <Sparkles className="size-3.5 text-muted-foreground" />
              </div>
              <CardDescription>Multi-source verification events captured for this transaction.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {purchase.walletEvents.map((event) => {
                const tapLocal = purchaseLocalDateTime(event.capturedAt, event.capturedTimezone);
                const uploadLocal = purchaseLocalDateTime(event.uploadedAt, event.capturedTimezone);
                const syncSeconds = Math.max(
                  0,
                  Math.round((new Date(event.uploadedAt).getTime() - new Date(event.capturedAt).getTime()) / 1000)
                );

                // Deduplicate merchant name if identical
                const rawNames = Array.from(
                  new Set([event.merchantRaw, event.transactionNameRaw].filter(Boolean))
                );

                return (
                  <div key={event.eventId} className="rounded-xl border border-border/80 bg-muted/20 p-3.5 text-xs space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Badge variant="info" size="sm">
                        Apple Pay Tap
                      </Badge>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {tapLocal.toFormat("MMM d · h:mm:ss a")}
                      </span>
                    </div>

                    <div className="space-y-1 text-muted-foreground">
                      <div>
                        <span className="text-foreground font-medium">Reported Merchant: </span>
                        {rawNames.map((n) => `“${n}”`).join(" / ")}
                      </div>

                      {event.cardRaw ? (
                        <div>
                          <span className="text-foreground font-medium">Card Identifier: </span>
                          <span className="font-mono">{event.cardRaw}</span>
                          {event.resolvedCardId ? (
                            <span className="text-primary font-medium"> → {cardName(event.resolvedCardId) ?? event.resolvedCardId}</span>
                          ) : (
                            <span className="text-muted-foreground"> (unmapped)</span>
                          )}
                        </div>
                      ) : null}

                      <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground border-t border-border/40">
                        <Clock className="size-3 text-muted-foreground" />
                        <span>Synced at {uploadLocal.toFormat("h:mm:ss a")} ({syncSeconds}s latency)</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {purchase.emailTransactions.map((email) => (
                <div key={email.id} className="rounded-xl border border-border/80 bg-muted/20 p-3.5 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant="success" size="sm">
                      Email Receipt
                    </Badge>
                    {email.purchasedAt ? (
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {purchaseLocalDateTime(email.purchasedAt, null, homeZone).toFormat("MMM d · h:mm a")}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-0.5 text-muted-foreground">
                    {email.fromEmail ? <div>From: {email.fromEmail}</div> : null}
                    {email.subject ? <div className="truncate font-medium text-foreground">“{email.subject}”</div> : null}
                    {email.orderId ? <div>Order ID: {email.orderId}</div> : null}
                  </div>
                </div>
              ))}

              {purchase.walletEvents.length === 0 && purchase.emailTransactions.length === 0 ? (
                <p className="text-xs text-muted-foreground">Recorded directly via manual input.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
