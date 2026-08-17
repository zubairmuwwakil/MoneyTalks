import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getSessionAccount } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Two scopes, deliberately distinct. "data" keeps the account and empties it — the long-standing
// web behaviour. "account" is Apple 5.1.1(v) deletion: the row goes, everything cascades off it,
// and the Clerk user that authenticates the row goes with it.
type Scope = "data" | "account";

async function readScope(request: Request): Promise<Scope | null> {
  // The existing web button posts no body at all; that has always meant "data".
  const raw = await request.text();
  if (!raw) return "data";
  try {
    const scope = (JSON.parse(raw) as { scope?: unknown }).scope ?? "data";
    return scope === "data" || scope === "account" ? scope : null;
  } catch {
    return null;
  }
}

// Deleting the User row cascades every child table (every `user` relation in schema.prisma
// declares onDelete: Cascade), so full deletion needs no table list and cannot fall behind the
// schema. Wiping data while KEEPING the account cannot use that trick, so this list exists —
// and every new user-owned table has to be added to it.
async function wipeUserOwnedData(userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.notificationJob.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.notificationPreference.deleteMany({ where: { userId } });
    await tx.snoozedEvent.deleteMany({ where: { userId } });

    // The merged foreign keys cascade return children and purchase children.
    await tx.returnItem.deleteMany({ where: { userId } });
    await tx.subscriptionPayment.deleteMany({ where: { userId } });
    await tx.subscription.deleteMany({ where: { userId } });
    await tx.purchase.deleteMany({ where: { userId } });
    await tx.emailTransaction.deleteMany({ where: { userId } });
    await tx.receiptUpload.deleteMany({ where: { userId } });
    await tx.receiptDocument.deleteMany({ where: { userId } });

    await tx.automationSuggestion.deleteMany({ where: { userId } });
    await tx.detectedItem.deleteMany({ where: { userId } });
    await tx.valueEvent.deleteMany({ where: { userId } });
    await tx.emailConnection.deleteMany({ where: { userId } });

    // The purchase spine the iOS app writes into. Omitted before this chunk, which left a
    // "delete my data" that quietly kept every captured wallet event and cap ledger row.
    await tx.walletEvent.deleteMany({ where: { userId } });
    await tx.walletInstallation.deleteMany({ where: { userId } });
    await tx.capAccrual.deleteMany({ where: { userId } });
    await tx.capUsageLedger.deleteMany({ where: { userId } });
    await tx.ownerStateRecord.deleteMany({ where: { userId } });
    await tx.coverageReport.deleteMany({ where: { userId } });
  });
}

function isAlreadyDeleted(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: number }).status === 404;
}

export async function POST(request: Request) {
  const account = await getSessionAccount();
  if (!account) return new NextResponse("Unauthorized", { status: 401 });

  const scope = await readScope(request);
  if (!scope) return NextResponse.json({ error: "Unknown deletion scope" }, { status: 400 });

  const job = await prisma.dataDeletionJob.create({
    data: { userId: account.id, status: "RUNNING" },
  });

  try {
    if (scope === "data") {
      await wipeUserOwnedData(account.id);
    } else {
      // Cascades the job row above with it: a deleted account leaves no residue, not even the
      // record of its own deletion.
      await prisma.user.delete({ where: { id: account.id } });
    }
  } catch (error) {
    await prisma.dataDeletionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: "Failed to delete data" }, { status: 500 });
  }

  if (scope === "data") {
    await prisma.dataDeletionJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return NextResponse.json({ ok: true, jobId: job.id, scope });
  }

  // Clerk goes last on purpose. If it fails, the data is already gone (the part that matters)
  // and the user can still sign in to retry — which re-creates an empty row and deletes it
  // again, idempotently. The reverse order would strand undeleted data behind a dead login.
  try {
    const clerk = await clerkClient();
    await clerk.users.deleteUser(account.clerkId);
  } catch (error) {
    if (!isAlreadyDeleted(error)) {
      return NextResponse.json(
        {
          error: "Your data was deleted, but removing the sign-in failed. Sign in and try again.",
          dataDeleted: true,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, scope });
}
