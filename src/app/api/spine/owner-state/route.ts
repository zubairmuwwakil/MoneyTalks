import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { ownerStateForWire, ownerStateInput } from "@/lib/validation/owner-state";
import { ensureOwnerStateRecord, mergeOwnerState } from "@/lib/domain/ownerState";

export const dynamic = "force-dynamic";

// A read-merge-write can lose a race, so it gets a bounded retry rather than
// the single opportunistic pass reconcileOwnedCards uses. That one converges
// on the next read because it is idempotent; this one is carrying a user's
// edit, and silently not persisting a wallet change is the failure the whole
// merge exists to prevent.
const MAX_MERGE_ATTEMPTS = 3;

/// The wallet as the server currently holds it. PickMe reads this on first run
/// so a user who already has cards on the web does not re-enter them by hand;
/// `ensureOwnerStateRecord` also folds in any contract-linked CreditCard rows
/// added since the last write.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  const record = await ensureOwnerStateRecord(prisma, userId);
  // Null is a real answer — the user owns no catalogue-linked cards yet — and
  // is distinct from an error. The client must show its own empty picker
  // rather than an error state.
  if (!record) return NextResponse.json({ ownerState: null, updatedAt: null });
  return NextResponse.json({
    ownerState: ownerStateForWire(record.stateData),
    updatedAt: record.updatedAt.toISOString(),
  });
}

/// Merges the caller's wallet into the stored one. This is deliberately NOT a
/// replace: see mergeOwnerState in src/lib/domain/ownerState.ts for the policy
/// and why each field takes the rule it does. Cap usage stays in its own
/// ledger, so a setup edit still cannot erase observed spend.
export async function PUT(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = ownerStateInput.safeParse(body);
  if (!parsed.success) {
    console.error("PUT /api/spine/owner-state validation error:", JSON.stringify(parsed.error.issues, null, 2));
    return NextResponse.json({ error: "invalid owner state", issues: parsed.error.issues }, { status: 400 });
  }

  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
    const existing = await prisma.ownerStateRecord.findUnique({ where: { userId } });

    if (!existing) {
      try {
        const created = await prisma.ownerStateRecord.create({
          data: { userId, stateData: parsed.data as unknown as Prisma.InputJsonValue },
          select: { stateData: true, updatedAt: true },
        });
        return NextResponse.json({
          ownerState: ownerStateForWire(created.stateData),
          updatedAt: created.updatedAt.toISOString(),
        });
      } catch {
        // A concurrent request created the row first (userId is unique). Fall
        // through to the next attempt, which will find it and merge into it —
        // never overwrite it, which is what a plain upsert would have done.
        continue;
      }
    }

    const merged = mergeOwnerState(existing.stateData, parsed.data);
    // `updatedAt` doubles as a version token: Prisma bumps it on every write,
    // so a row changed since our read matches zero rows here instead of
    // silently clobbering the other writer.
    const { count } = await prisma.ownerStateRecord.updateMany({
      where: { userId, updatedAt: existing.updatedAt },
      data: { stateData: merged as unknown as Prisma.InputJsonValue },
    });
    if (count === 1) {
      const latest = await prisma.ownerStateRecord.findUnique({
        where: { userId },
        select: { stateData: true, updatedAt: true },
      });
      return NextResponse.json({
        ownerState: ownerStateForWire(latest?.stateData ?? merged),
        updatedAt: (latest?.updatedAt ?? new Date()).toISOString(),
      });
    }
  }

  // Contention this persistent is not something the caller can fix by editing
  // its payload, so it is reported as a conflict to retry, never as success.
  return NextResponse.json({ error: "owner state is being written concurrently" }, { status: 409 });
}
