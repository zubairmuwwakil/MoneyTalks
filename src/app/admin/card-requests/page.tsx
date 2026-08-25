import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-user";

export default async function CardRequestsAdminPage() {
  await requireAdmin();

  // Group by card and count descending
  const requests = await prisma.cardRequest.groupBy({
    by: ["issuer", "cardName"],
    _count: { _all: true },
    orderBy: {
      _count: { cardName: "desc" },
    },
  });

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Card Requests Demand Signal</h1>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-6 py-3 font-medium text-gray-500">Issuer</th>
              <th className="px-6 py-3 font-medium text-gray-500">Card Name</th>
              <th className="px-6 py-3 font-medium text-gray-500">Requests (Count)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {requests.map((req, i) => (
              <tr key={i}>
                <td className="px-6 py-4">{req.issuer}</td>
                <td className="px-6 py-4">{req.cardName}</td>
                <td className="px-6 py-4 font-semibold text-gray-900">
                  {req._count._all}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {requests.length === 0 && (
          <div className="p-6 text-center text-gray-500">No requests yet.</div>
        )}
      </div>
    </div>
  );
}
