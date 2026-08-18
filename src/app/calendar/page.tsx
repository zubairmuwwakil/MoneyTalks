import { requireUserId } from "@/lib/require-user";
import CalendarClient from "./ui/CalendarClient";

// Events change server-side (bills paid, snoozes, cards edited) between
// visits, and this page has no cache to invalidate — always render fresh.
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  await requireUserId();

  return (
    <main className="space-y-6 py-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Every dated obligation in one place — bills, subscriptions, returns, and annual-fee decisions.
        </p>
      </div>

      <CalendarClient />
    </main>
  );
}
