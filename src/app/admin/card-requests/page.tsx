import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-user";
import { redirect } from "next/navigation";
import { openCatalogueRequestPr } from "@/lib/services/catalogueRequestPr";

export default async function CardRequestsAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = (await searchParams) ?? {};

  /// Starts the catalogue work where the demand signal lands, without moving ownership: the PR
  /// carries a sourcing brief and checklist, and a human authors the entry in PickMe against
  /// issuer pages. Nothing rate-shaped is composed here.
  async function openRequestPr(formData: FormData) {
    "use server";
    // Re-checked here, not just on the page: a server action is directly invokable.
    await requireAdmin();
    const result = await openCatalogueRequestPr({
      issuer: String(formData.get("issuer") ?? ""),
      cardName: String(formData.get("cardName") ?? ""),
      requestCount: Number(formData.get("requestCount") ?? 0),
    });
    if (!result.ok) redirect(`/admin/card-requests?error=${encodeURIComponent(result.error)}`);
    redirect(result.url);
  }

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
      <h1 className="text-2xl font-bold mb-2">Card Requests Demand Signal</h1>
      <p className="mb-6 text-sm text-gray-600">
        Opening a PR files a sourcing brief against PickMe, which owns card semantics. Rates are
        written there against the issuer&apos;s own terms — never composed here.
      </p>
      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-6 py-3 font-medium text-gray-500">Issuer</th>
              <th className="px-6 py-3 font-medium text-gray-500">Card Name</th>
              <th className="px-6 py-3 font-medium text-gray-500">Requests (Count)</th>
              <th className="px-6 py-3 font-medium text-gray-500">Catalogue</th>
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
                <td className="px-6 py-4">
                  <form action={openRequestPr}>
                    <input type="hidden" name="issuer" value={req.issuer} />
                    <input type="hidden" name="cardName" value={req.cardName} />
                    <input type="hidden" name="requestCount" value={req._count._all} />
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 px-3 py-1 text-xs font-semibold hover:bg-gray-50"
                    >
                      Open sourcing PR
                    </button>
                  </form>
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
