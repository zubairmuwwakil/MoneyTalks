import { requireUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils/calendarEvents";

export default async function ReceiptBrowserPage() {
  const userId = await requireUserId();

  type ReceiptRow = {
    id: string;
    merchant: string;
    subject: string | null;
    totalCents: number | null;
    currency: string;
    purchasedAt: Date | null;
    items: unknown;
    orderId: string | null;
    fromEmail: string | null;
    receiptDocuments: { id: string; filename: string; storagePath: string; sizeBytes: number }[];
  };

  const receipts: ReceiptRow[] = await prisma.emailTransaction.findMany({
    where: { userId },
    include: { receiptDocuments: true },
    orderBy: { purchasedAt: "desc" },
    take: 100,
  });

  if (receipts.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-slate-900">Receipt Browser</h1>
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center">
          <p className="text-slate-600">No receipts yet. Gmail scanning will find and store receipt emails here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Receipt Browser</h1>
        <p className="mt-1 text-slate-600">View all parsed receipt emails with attachments</p>
      </div>

      <div className="space-y-3">
        {receipts.map(receipt => (
          <div key={receipt.id} className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-900">{receipt.merchant}</h3>
                <p className="text-sm text-slate-600">
                  {receipt.purchasedAt?.toLocaleDateString("en-CA")} {receipt.purchasedAt ? "·" : ""} {receipt.subject}
                </p>
              </div>
              {receipt.totalCents && (
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-900">
                    {formatMoney(receipt.totalCents, receipt.currency)}
                  </p>
                </div>
              )}
            </div>

            {receipt.items && Array.isArray(receipt.items) && receipt.items.length > 0 ? (
              <div className="mb-4 space-y-1">
                {receipt.items.slice(0, 3).map((item: unknown, idx: number) => {
                  const obj = item as Record<string, unknown>;
                  const name = String(obj.name || obj.description || "Item");
                  const qty = obj.quantity ? `(${obj.quantity})` : "";
                  return (
                    <p key={idx} className="text-sm text-slate-600">
                      • {name} {qty}
                    </p>
                  );
                })}
                {receipt.items.length > 3 && (
                  <p className="text-xs text-slate-500">+{receipt.items.length - 3} more items</p>
                )}
              </div>
            ) : null}

            {receipt.receiptDocuments.length > 0 && (
              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-slate-500 mb-2">Attachments</p>
                <div className="space-y-2">
                  {receipt.receiptDocuments.map(doc => (
                    <div key={doc.id} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2">
                      <span className="text-sm">📄</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{doc.filename}</p>
                        <p className="text-xs text-slate-500">{(doc.sizeBytes / 1024).toFixed(1)} KB</p>
                      </div>
                      <a
                        href={doc.storagePath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        View
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {receipt.orderId && (
                <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">
                  Order: {receipt.orderId}
                </span>
              )}
              {receipt.fromEmail && (
                <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">
                  From: {receipt.fromEmail}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
