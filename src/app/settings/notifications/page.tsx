import { getSessionUserId } from "@/lib/require-user";
import { redirect } from "next/navigation";
import NotificationSettings from "../NotificationSettings";

// Home for the notification/digest preferences, including home timezone.
export default async function NotificationSettingsPage() {
  const userId = await getSessionUserId();
  if (!userId) {
    redirect("/login");
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 lg:p-8">
      <NotificationSettings />
    </div>
  );
}
