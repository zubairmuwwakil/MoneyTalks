import { prisma } from "@/lib/prisma";
import { DateTime } from "luxon";

function iso(d?: Date | null) {
  return d ? d.toISOString().slice(0, 10) : "date unknown";
}

export async function buildDigestForUser(userId: string, now: Date, tz = "America/Toronto") {
  const startLocal = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
  const endLocal = startLocal.plus({ days: 1 });

  const startUtc = startLocal.toUTC().toJSDate();
  const endUtc = endLocal.toUTC().toJSDate();
  const dateLocal = startLocal.toISODate()!;

  const notifs = await prisma.notification.findMany({
    where: {
      userId,
      dismissedAt: null,
      emailedAt: null, // ✅ consume gate
      scheduledFor: { gte: startUtc, lt: endUtc },
    },
    select: { id: true, type: true, title: true, body: true, eventDate: true },
    orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }],
  });

  if (!notifs.length) return null;

  type Notif = typeof notifs[number];
  const returns = notifs.filter((n: Notif) => ["RETURN_DEADLINE_SOON", "REFUND_CHECK_DUE", "REFUND_OVERDUE"].includes(n.type));
  const bills = notifs.filter((n: Notif) => n.type === "BILL_DUE_SOON");
  const subs = notifs.filter((n: Notif) => n.type === "SUBSCRIPTION_RENEWAL_SOON");
  const overdue = notifs.filter((n: Notif) => n.type === "REFUND_OVERDUE").length;

  const sections = {
    returns: returns.map((n: Notif) => ({ title: n.title, date: n.body ?? iso(n.eventDate), link: "/dashboard/calendar" })),
    bills: bills.map((n: Notif) => ({ title: n.title, date: n.body ?? iso(n.eventDate), link: "/dashboard/calendar" })),
    subs: subs.map((n: Notif) => ({ title: n.title, date: n.body ?? iso(n.eventDate), link: "/dashboard/calendar" })),
  };

  const counts = {
    returns: sections.returns.length,
    bills: sections.bills.length,
    subs: sections.subs.length,
    overdue,
  };

  const subject = `Your digest: ${counts.returns} returns · ${counts.bills} bills · ${counts.subs} subs`;

  return {
    dateLocal,
    notificationIds: notifs.map((n: Notif) => n.id),
    digest: { subject, counts, sections },
  };
}
