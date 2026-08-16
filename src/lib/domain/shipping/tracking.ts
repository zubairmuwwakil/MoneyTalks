import "server-only";
import { prisma } from "@/lib/prisma";
import { scheduleReturnDelivered } from "@/lib/domain/notifications/eventNotificationScheduler";
import { canTransition, type ReturnStatus } from "@/engine/returns/transitions";

type ShipmentStage = { code: string; label: string };

const STAGES: ShipmentStage[] = [
  { code: "LABEL_CREATED", label: "Label created" },
  { code: "IN_TRANSIT", label: "In transit" },
  { code: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { code: "DELIVERED", label: "Delivered" },
];

function addDaysUTC(base: Date, days: number) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function stageIndex(code: string) {
  return STAGES.findIndex(s => s.code === code);
}

function clampToPast(target: Date, now: Date) {
  return target > now ? now : target;
}

function deriveTargetStage(ret: {
  trackingNumber: string | null;
  dropoffDate: Date | null;
  deliveredAt: Date | null;
  status: string;
}, now: Date) {
  if (!ret.trackingNumber) return null;
  if (ret.status === "REFUNDED") return null;
  if (ret.deliveredAt || ret.status === "DELIVERED") return "DELIVERED";
  if (ret.dropoffDate) {
    const ageDays = Math.floor((now.getTime() - ret.dropoffDate.getTime()) / 86_400_000);
    if (ageDays >= 4) return "DELIVERED";
    if (ageDays >= 2) return "OUT_FOR_DELIVERY";
    return "IN_TRANSIT";
  }
  return "LABEL_CREATED";
}

async function upsertRefundCase(args: {
  userId: string;
  returnId: string;
  expectedAt?: Date | null;
  receivedAt?: Date | null;
  refundType?: string | null;
  overdueNotifiedAt?: Date | null;
}) {
  const data: Record<string, unknown> = {};
  if (args.expectedAt !== undefined) data.expectedAt = args.expectedAt;
  if (args.receivedAt !== undefined) data.receivedAt = args.receivedAt;
  if (args.refundType !== undefined) data.refundType = args.refundType ?? null;
  if (args.overdueNotifiedAt !== undefined) data.overdueNotifiedAt = args.overdueNotifiedAt;

  await prisma.refundCase.upsert({
    where: { returnId: args.returnId },
    create: {
      userId: args.userId,
      returnId: args.returnId,
      expectedAt: (data.expectedAt as Date | null | undefined) ?? null,
      receivedAt: (data.receivedAt as Date | null | undefined) ?? null,
      refundType: (data.refundType as string | null | undefined) ?? null,
    },
    update: data,
  });
}

export async function refreshShipmentTimeline(params: {
  userId: string;
  returnId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const ret = await prisma.returnItem.findFirst({
    where: { id: params.returnId, userId: params.userId },
    include: { shipmentEvents: { orderBy: { occurredAt: "asc" } } },
  });
  if (!ret) return { returnItem: null, eventsAdded: [] as Awaited<ReturnType<typeof prisma.shipmentEvent.create>>[] };

  const targetStageCode = deriveTargetStage(ret, now);
  if (!targetStageCode) return { returnItem: ret, eventsAdded: [] as Awaited<ReturnType<typeof prisma.shipmentEvent.create>>[] };

  const existingMaxIdx = ret.shipmentEvents.reduce((max, ev) => Math.max(max, stageIndex(ev.statusCode)), -1);
  const targetIdx = stageIndex(targetStageCode);

  if (targetIdx <= existingMaxIdx) {
    return { returnItem: ret, eventsAdded: [] as Awaited<ReturnType<typeof prisma.shipmentEvent.create>>[] };
  }

  const anchor = ret.dropoffDate ?? ret.createdAt ?? now;
  let cursor = ret.shipmentEvents.at(-1)?.occurredAt ?? anchor;
  const updates: Record<string, unknown> = {};
  const eventsAdded: Awaited<ReturnType<typeof prisma.shipmentEvent.create>>[] = [];
  const setForwardStatus = (nextStatus: ReturnStatus) => {
    const from = (updates.status as ReturnStatus | undefined) ?? (ret.status as ReturnStatus);
    if (canTransition(from, nextStatus)) updates.status = nextStatus;
  };

  for (let idx = existingMaxIdx + 1; idx <= targetIdx; idx++) {
    const stage = STAGES[idx];
    if (!stage) continue;

    let occurredAt = clampToPast(addDaysUTC(anchor, Math.max(idx, 0)), now);
    if (occurredAt <= cursor) occurredAt = new Date(cursor.getTime() + 60_000);

    const ev = await prisma.shipmentEvent.create({
      data: {
        userId: params.userId,
        returnId: ret.id,
        statusCode: stage.code,
        statusText: stage.label,
        occurredAt,
        location: null,
      },
    });
    eventsAdded.push(ev);
    cursor = occurredAt;

    if (stage.code === "LABEL_CREATED") {
      setForwardStatus("PACKED");
    }

    if (stage.code === "IN_TRANSIT" || stage.code === "OUT_FOR_DELIVERY") {
      if (!ret.dropoffDate && updates.dropoffDate === undefined) updates.dropoffDate = occurredAt;
      setForwardStatus("DROPPED_OFF");
    }

    if (stage.code === "DELIVERED") {
      updates.deliveredAt = ret.deliveredAt ?? occurredAt;
      setForwardStatus("DELIVERED");
      const expected =
        ret.refundExpectedAt ??
        (updates.deliveredAt
          ? addDaysUTC(updates.deliveredAt as Date, ret.refundSlaDays ?? 14)
          : null);
      if (expected && ret.refundExpectedAt == null && updates.refundExpectedAt === undefined) {
        updates.refundExpectedAt = expected;
      }
      await scheduleReturnDelivered({
        userId: ret.userId,
        returnId: ret.id,
        store: ret.store,
        deliveredAt: (updates.deliveredAt as Date) ?? occurredAt,
      });
    }
  }

  if (Object.keys(updates).length > 0) {
    if (updates.refundSlaDays === undefined) updates.refundSlaDays = ret.refundSlaDays ?? 14;
    await prisma.returnItem.update({ where: { id: ret.id }, data: updates });
  }

  // Sync refund case if we have delivery or expectation info
  if (updates.deliveredAt || updates.refundExpectedAt || ret.refundExpectedAt || ret.deliveredAt) {
    await upsertRefundCase({
      userId: ret.userId,
      returnId: ret.id,
      expectedAt: (updates.refundExpectedAt as Date | undefined) ?? ret.refundExpectedAt ?? null,
      refundType: ret.refundType ?? null,
    });
  }

  const updatedReturn = await prisma.returnItem.findFirst({ where: { id: ret.id, userId: params.userId } });
  return { returnItem: updatedReturn, eventsAdded };
}

export async function setRefundReceived(args: { userId: string; returnId: string; receivedAt: Date; refundType?: string | null }) {
  await upsertRefundCase({
    userId: args.userId,
    returnId: args.returnId,
    receivedAt: args.receivedAt,
    refundType: args.refundType ?? null,
  });
}

export async function syncRefundExpectation(args: { userId: string; returnId: string; expectedAt: Date | null; refundType?: string | null }) {
  await upsertRefundCase({
    userId: args.userId,
    returnId: args.returnId,
    expectedAt: args.expectedAt,
    refundType: args.refundType ?? null,
  });
}
