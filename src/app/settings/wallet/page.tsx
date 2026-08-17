import { getSessionUserId } from "@/lib/require-user";
import { redirect } from "next/navigation";
import WalletSettingsClient from "./WalletSettingsClient";

export default async function WalletSettingsPage() {
  const userId = await getSessionUserId();
  if (!userId) {
    redirect("/login");
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-bold mb-6">Apple Wallet Integrations</h1>
      <WalletSettingsClient />
    </div>
  );
}
