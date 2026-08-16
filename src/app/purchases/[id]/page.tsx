import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils/calendarEvents";
import { requireUserId } from "@/lib/require-user";

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;

  const purchase = await prisma.purchase.findFirst({
    where: { id, userId },
    include: { items: true, attachments: true, returns: true },
  });

  if (!purchase) {
    return <div className="p-6">Not found</div>;
  }

  const returnItem = purchase.returns[0] ?? null;

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
              {purchase.purchasedAt.toLocaleDateString("en-CA")} {purchase.orderNumber ? `· Order ${purchase.orderNumber}` : ""}
            </div>
          </div>
          <div className="text-right">
            {typeof purchase.totalCents === "number" ? (
              <div className="text-lg font-semibold text-slate-900">{formatMoney(purchase.totalCents, purchase.currency)}</div>
            ) : null}
            <div className="text-xs text-slate-500">Source: {purchase.source}</div>
          </div>
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
