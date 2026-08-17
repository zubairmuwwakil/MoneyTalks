import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { revalidatePath } from "next/cache";

export default async function WaitlistAdminPage() {
  await requireUserId();

  const entries = await prisma.waitlist.findMany({
    orderBy: { createdAt: "desc" },
  });

  async function toggleInvited(id: string, invited: boolean) {
    "use server";
    await requireUserId();
    await prisma.waitlist.update({
      where: { id },
      data: { invitedAt: invited ? new Date() : null },
    });
    revalidatePath("/admin/waitlist");
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Waitlist</h1>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-6 py-3 font-medium text-gray-500">Email</th>
              <th className="px-6 py-3 font-medium text-gray-500">Joined</th>
              <th className="px-6 py-3 font-medium text-gray-500">Status</th>
              <th className="px-6 py-3 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="px-6 py-4">{entry.email}</td>
                <td className="px-6 py-4">
                  {entry.createdAt.toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  {entry.invitedAt ? (
                    <span className="inline-flex rounded-full bg-green-100 px-2 text-xs font-semibold leading-5 text-green-800">
                      Invited
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-yellow-100 px-2 text-xs font-semibold leading-5 text-yellow-800">
                      Waiting
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <form
                    action={async () => {
                      "use server";
                      await toggleInvited(entry.id, !entry.invitedAt);
                    }}
                  >
                    <button
                      type="submit"
                      className="text-blue-600 hover:text-blue-900 font-medium"
                    >
                      {entry.invitedAt ? "Revoke Invite" : "Mark Invited"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && (
          <div className="p-6 text-center text-gray-500">No entries yet.</div>
        )}
      </div>
    </div>
  );
}
