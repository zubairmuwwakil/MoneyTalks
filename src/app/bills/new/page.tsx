import { redirect } from "next/navigation";
import { createBill } from "@/app/bills/actions";
import { requireUserId } from "@/lib/require-user";
import { BillFormFields } from "./form-fields";

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUserId();
  const { error } = await searchParams;

  async function submit(formData: FormData) {
    "use server";
    const result = await createBill(formData);
    if (result.ok) redirect("/bills");
    redirect(`/bills/new?error=${encodeURIComponent(result.error)}`);
  }

  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Add bill</h1>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <form action={submit} className="mt-6 max-w-xl space-y-4">
        <BillFormFields />
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">
          Create bill
        </button>
      </form>
    </main>
  );
}
