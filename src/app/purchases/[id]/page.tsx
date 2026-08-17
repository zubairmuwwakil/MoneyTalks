import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils/calendarEvents";
import { requireUserId } from "@/lib/require-user";
import { purchaseLocalDateTime } from "@/lib/utils/purchaseTime";

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;

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
      emailTransactions: {
        select: { id: true, fromEmail: true, subject: true, orderId: true, purchasedAt: true, provider: true },
      },
    },
  });

  if (!purchase) {
    return <div className="p-6">Not found</div>;
  }

  const returnItem = purchase.returns[0] ?? null;
  const wallet = purchase.walletEvents[0] ?? null;
  const local = purchaseLocalDateTime(wallet?.capturedAt ?? purchase.purchasedAt, wallet?.capturedTimezone);
  const whenFull = wallet
    ? `${local.toFormat("cccc, MMM d, yyyy · h:mm:ss a")} ${local.toFormat("ZZZZ")}`
    : local.toFormat("cccc, MMM d, yyyy");

  const cards = await prisma.creditCard.findMany({
    where: { userId, contractCardId: { not: null } },
    select: { nickname: true, contractCardId: true },
  });
  const cardName = (contractCardId: string | null) =>
    cards.find((c) => c.contractCardId === contractCardId)?.nickname ?? null;

  const flaggedTwin = purchase.possibleDuplicateOfId
    ? await prisma.purchase.findFirst({
        where: { id: purchase.possibleDuplicateOfId, userId },
        select: { id: true, merchant: true, totalCents: true, currency: true, purchasedAt: true },
      })
    : null;

  return (
    <main className="space-y-6">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/purchases" className="text-xs text-slate-500 hover:underline">
              ← Back to Purchases
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">{purchase.merchant}</h1>
            <div className="text-sm text-slate-500">
              {whenFull}
              {purchase.orderNumber ? ` · Order ${purchase.orderNumber}` : ""}
            </div>
            {wallet ? (
              <div className="mt-1 text-sm text-slate-500">
                Paid with {cardName(wallet.resolvedCardId) ?? wallet.cardRaw ?? "unknown card"}
              </div>
            ) : null}
          </div>
          <div className="text-right">
            {typeof purchase.totalCents === "number" ? (
              <div className="text-lg font-semibold text-slate-900">{formatMoney(purchase.totalCents, purchase.currency)}</div>
            ) : null}
            <div className="text-xs text-slate-500">First seen via {purchase.source}</div>
          </div>
        </div>
        {wallet?.feedbackWarning ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            {wallet.feedbackWarning}
          </div>
        ) : null}
      </div>

      {flaggedTwin ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900">
          Possibly the same purchase as{" "}
          <Link href={`/purchases/${flaggedTwin.id}`} className="font-medium underline">
            {flaggedTwin.merchant} · {formatMoney(flaggedTwin.totalCents ?? undefined, flaggedTwin.currency)}
          </Link>{" "}
          — amount and time matched, but the merchant names differ, so it was kept separate.
        </div>
      ) : null}

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Observations</div>
        <p className="mt-0.5 text-xs text-slate-500">Every source that saw this purchase, with what it reported.</p>
        <div className="mt-3 space-y-3">
          {purchase.walletEvents.map((event) => {
            const tapLocal = purchaseLocalDateTime(event.capturedAt, event.capturedTimezone);
            return (
              <div key={event.eventId} className="rounded-xl border px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700">Apple Pay tap</span>
                  <span className="text-slate-600">
                    {tapLocal.toFormat("MMM d · h:mm:ss a")} {tapLocal.toFormat("ZZZZ")}
                  </span>
                </div>
                <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                  <div>Apple reported: “{event.merchantRaw}”{event.transactionNameRaw ? ` / “${event.transactionNameRaw}”` : ""}</div>
                  {event.cardRaw ? <div>Card string: “{event.cardRaw}”{event.resolvedCardId ? ` → ${cardName(event.resolvedCardId) ?? event.resolvedCardId}` : " (not yet mapped)"}</div> : null}
                  {event.latitude != null && event.longitude != null ? (
                    <div>
                      Location: {event.latitude.toFixed(5)}, {event.longitude.toFixed(5)}
                      {event.locationAccuracyMeters != null ? ` (±${Math.round(event.locationAccuracyMeters)}m)` : ""}
                      {" · "}
                      <a
                        className="text-blue-600 hover:underline"
                        href={`https://maps.apple.com/?ll=${event.latitude},${event.longitude}&q=${encodeURIComponent(purchase.merchant)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Maps
                      </a>
                    </div>
                  ) : null}
                  <div>Uploaded {purchaseLocalDateTime(event.uploadedAt, event.capturedTimezone).toFormat("MMM d · h:mm:ss a")}{event.feedbackVerdict ? ` · verdict: ${event.feedbackVerdict}` : ""}</div>
                </div>
              </div>
            );
          })}
          {purchase.emailTransactions.map((email) => (
            <div key={email.id} className="rounded-xl border px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Email receipt</span>
                {email.purchasedAt ? (
                  <span className="text-slate-600">{purchaseLocalDateTime(email.purchasedAt).toFormat("MMM d · h:mm a")}</span>
                ) : null}
              </div>
              <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                {email.fromEmail ? <div>From {email.fromEmail}</div> : null}
                {email.subject ? <div className="truncate">“{email.subject}”</div> : null}
                {email.orderId ? <div>Order {email.orderId}</div> : null}
              </div>
            </div>
          ))}
          {purchase.walletEvents.length === 0 && purchase.emailTransactions.length === 0 ? (
            <div className="text-xs text-slate-500">Recorded directly ({purchase.source.toLowerCase()}).</div>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Quick actions</div>
        {returnItem ? (
          <div className="mt-2 text-sm text-slate-600">Return exists: {returnItem.status}</div>
        ) : (
          <form action={`/api/purchases/${purchase.id}/create-return`} method="post" className="mt-3">
            <button className="rounded-full border px-4 py-2 text-sm hover:bg-slate-50">Start a return</button>
          </form>
        )}
      </div>

      {purchase.items.length > 0 ? (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Items</div>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {purchase.items.map((item) => (
              <li key={item.id}>
                {item.title}
                {item.qty ? ` × ${item.qty}` : ""}
                {typeof item.priceCents === "number" ? ` · ${formatMoney(item.priceCents, item.currency)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {purchase.attachments.length > 0 ? (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Attachments</div>
          <div className="mt-3 space-y-2">
            {purchase.attachments.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <div className="truncate">{doc.storageKey}</div>
                <a href={`/api/documents/${doc.id}`} className="text-blue-600 hover:underline">
                  Download
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  );
}
