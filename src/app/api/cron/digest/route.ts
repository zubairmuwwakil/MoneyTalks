import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendEmail } from "@/lib/services/email";
import { buildDigestForUser } from "@/lib/domain/notifications/digestBuilder";
import { claimDueDigestJobs, nextRetrySendAt, scheduleNextDigestJob } from "@/lib/domain/notifications/digestJobScheduler";

export const runtime = "nodejs";

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderDigestEmail(args: { appUrl: string; digest: NonNullable<Awaited<ReturnType<typeof buildDigestForUser>>>["digest"] }) {
  const { appUrl, digest } = args;
  const renderSection = (title: string, items: { title: string; date: string; amount?: string; link?: string }[]) => {
    if (!items.length) return "";
    return `
      <h3 style="margin:12px 0 6px 0;">${escapeHtml(title)}</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${items
          .map(
            i => `
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #eee;">
                <div style="font-weight:600;">${escapeHtml(i.title)}</div>
                <div style="color:#555;">${escapeHtml(i.date)}${i.amount ? ` · ${escapeHtml(i.amount)}` : ""}</div>
                ${i.link ? `<div><a href="${appUrl}${i.link}" style="color:#2563eb;text-decoration:none;">View</a></div>` : ""}
              </td>
            </tr>
          `
          )
          .join("")}
      </table>
    `;
  };

  return `
  <div style="font-family: ui-sans-serif, system-ui; line-height:1.4; color:#111;">
    <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#2563eb; margin-bottom:6px;">PickMe Hub</div>
    <h2 style="margin:0 0 8px 0;">${escapeHtml(digest.subject)}</h2>
    <div style="color:#555;margin-bottom:16px;">Returns: ${digest.counts.returns} · Bills: ${digest.counts.bills} · Subs: ${digest.counts.subs} · Overdue: ${digest.counts.overdue}</div>

    ${renderSection("Returns", digest.sections.returns)}
    ${renderSection("Bills", digest.sections.bills)}
    ${renderSection("Subscriptions", digest.sections.subs)}

    <div style="margin-top:18px;">
      <a href="${appUrl}/returns" style="display:inline-block;padding:10px 14px;border:1px solid #ddd;border-radius:12px;text-decoration:none;color:#111;">
        View returns
      </a>
      <a href="${appUrl}/notifications" style="display:inline-block;margin-left:10px;padding:10px 14px;border:1px solid #ddd;border-radius:12px;text-decoration:none;color:#111;">
        View notifications
      </a>
    </div>

    <div style="margin-top:18px;color:#777;font-size:12px;">
      You can turn digests off anytime in Settings.
    </div>
  </div>
  `;
}

async function runDigestCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const now = new Date();

  const { jobs } = await claimDueDigestJobs(25);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ userId: string; jobId: string; error: string }> = [];

  for (const job of jobs) {
    const userId = job.userId as string;

    const pref = await prisma.notificationPreference.findUnique({
      where: { userId },
      select: { emailDigestEnabled: true, timezone: true, digestHourLocal: true, primaryEmail: true },
    });

    // If user disabled digest after job was created
    if (!pref?.emailDigestEnabled) {
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: { status: "CANCELED", lockedAt: null, lockId: null },
      });
      skipped++;
      continue;
    }

    const to = pref.primaryEmail;
    if (!to) {
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: { status: "CANCELED", lastError: "Missing primaryEmail", lockedAt: null, lockId: null },
      });
      skipped++;
      continue;
    }

    try {
      const tz = pref.timezone ?? "America/Toronto";
      const built = await buildDigestForUser(userId, now, tz);
      if (!built) {
        // nothing to send today — still mark sent and schedule next day
        await prisma.notificationJob.update({
          where: { id: job.id },
          data: { status: "SENT", sentAt: now, lockedAt: null, lockId: null, lastError: null },
        });

        await scheduleNextDigestJob(userId, { timezone: tz, digestHourLocal: pref.digestHourLocal }, now);
        skipped++;
        continue;
      }

      const { digest, notificationIds } = built;

      await sendEmail({
        to,
        subject: digest.subject,
        html: renderDigestEmail({ appUrl, digest }),
      });

      await prisma.notification.updateMany({
        where: { id: { in: notificationIds } },
        data: { emailedAt: now },
      });

      await prisma.notificationJob.update({
        where: { id: job.id },
        data: { status: "SENT", sentAt: now, lockedAt: null, lockId: null, lastError: null },
      });

      // chain schedule the next job
      await scheduleNextDigestJob(
        userId,
        { timezone: tz, digestHourLocal: pref.digestHourLocal },
        now
      );

      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ userId, jobId: job.id, error: message });

      // retry with backoff
      const retryAt = nextRetrySendAt(now, job.attempts as number);

      await prisma.notificationJob.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          sendAt: retryAt,
          lastError: message,
          lockedAt: null,
          lockId: null,
        },
      });

      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    claimed: jobs.length,
    sent,
    skipped,
    failed,
    errors,
  });
}

export async function GET(req: NextRequest) {
  return runDigestCron(req);
}

export async function POST(req: NextRequest) {
  return runDigestCron(req);
}
