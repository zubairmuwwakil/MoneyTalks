import { getReturnTransactionHistory } from "@/lib/utils/transactionHistory";
import { formatMoney } from "@/lib/utils/calendarEvents";

interface ReturnTransactionHistoryProps {
  userId: string;
  returnId: string;
}

export default async function ReturnTransactionHistory({
  userId,
  returnId,
}: ReturnTransactionHistoryProps) {
  const transactions = await getReturnTransactionHistory(userId, returnId);

  if (transactions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-slate-300">
        No history yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {transactions.map(tx => {
        const icon =
          tx.type === "refund"
            ? "💰"
            : tx.status === "DELIVERED"
            ? "📬"
            : tx.status?.includes("TRANSIT")
            ? "🚚"
            : tx.status === "COMPLETED"
            ? "✅"
            : "📅";
        return (
          <div key={tx.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100">
            <div className="flex items-center gap-3">
              <span className="text-xl">{icon}</span>
              <div>
                <p className="font-medium text-white">{tx.title}</p>
                <p className="text-xs text-slate-400">
                  {tx.date.toLocaleDateString("en-CA")}
                </p>
              </div>
            </div>
            <div className="text-right">
              {tx.amount > 0 && (
                <p className={`font-semibold ${tx.type === "refund" ? "text-emerald-100" : "text-slate-100"}`}>
                  {tx.type === "refund" ? "+" : "-"}{formatMoney(tx.amount, tx.currency)}
                </p>
              )}
              {tx.notes && (
                <p className="text-xs text-slate-400">{tx.notes}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
