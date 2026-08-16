//upload page for clinets only

import { requireUserId } from "@/lib/require-user";
import ReceiptUploadForm from "./ui/ReceiptUploadForm";

export default async function UploadReceiptPage() {
  await requireUserId();

  return (
    <main className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Upload a receipt</h1>
        <p className="text-sm opacity-70">PDF works best. Images are accepted but may need manual confirmation.</p>
      </div>

      <ReceiptUploadForm />
    </main>
  );
}
