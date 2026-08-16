/**
 * importLooplyExport.ts
 * 
 * Imports looply-export.json data (produced by return-saas's /api/data/export) into MoneyTalks.
 * Only keepers (ReturnItem history, ValueEvents) are imported.
 * Live/operational data (purchases, subscriptions, etc.) are skipped and will re-arrive via re-ingestion.
 * 
 * Usage:
 *   npx tsx scripts/importLooplyExport.ts --file <path to looply-export.json> --email <owner email>
 * 
 * It runs in DRY RUN mode by default. To actually write to the database, pass --apply:
 *   npx tsx scripts/importLooplyExport.ts --file <path to looply-export.json> --email <owner email> --apply
 */

import { parseArgs } from "node:util";
import fs from "node:fs/promises";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const ShipmentEventSchema = z.object({
  statusCode: z.string(),
  statusText: z.string(),
  occurredAt: z.string().datetime(),
  location: z.string().nullable().optional(),
  raw: z.any().optional(),
});

const RefundCaseSchema = z.object({
  expectedAt: z.string().datetime().nullable().optional(),
  receivedAt: z.string().datetime().nullable().optional(),
  overdueNotifiedAt: z.string().datetime().nullable().optional(),
  refundType: z.string().nullable().optional(),
});

const ReturnItemSchema = z.object({
  store: z.string(),
  itemNote: z.string().nullable().optional(),
  amountCents: z.number().nullable().optional(),
  currency: z.string().default("CAD"),
  purchaseDate: z.string().datetime(),
  returnWindowDays: z.number().default(30),
  returnBy: z.string().datetime(),
  status: z.enum(["NOT_STARTED", "PACKED", "DROPPED_OFF", "DELIVERED", "REFUNDED"]).default("NOT_STARTED"),
  trackingNumber: z.string().nullable().optional(),
  carrier: z.string().nullable().optional(),
  dropoffDate: z.string().datetime().nullable().optional(),
  deliveredAt: z.string().datetime().nullable().optional(),
  refundExpectedAt: z.string().datetime().nullable().optional(),
  refundedDate: z.string().datetime().nullable().optional(),
  refundAmountCents: z.number().nullable().optional(),
  refundSlaDays: z.number().default(14),
  refundType: z.string().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),

  shipmentEvents: z.array(ShipmentEventSchema).optional().default([]),
  refundCase: RefundCaseSchema.nullable().optional(),
});

const ValueEventSchema = z.object({
  type: z.enum(["AVOIDED_RENEWAL", "REFUND_RECEIVED", "FEE_AVOIDED"]),
  amountCents: z.number(),
  currency: z.string().default("CAD"),
  occurredAt: z.string().datetime(),
  isEstimated: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const ExportSchema = z.object({
  returnItems: z.array(ReturnItemSchema).optional().default([]),
  valueEvents: z.array(ValueEventSchema).optional().default([]),
});

export async function processExport(
  prisma: PrismaClient,
  userId: string,
  exportData: unknown,
  apply: boolean
) {
  const parsed = ExportSchema.parse(exportData);
  let returnItemsCreated = 0;
  let returnItemsSkipped = 0;
  let valueEventsCreated = 0;
  let valueEventsSkipped = 0;

  for (const ri of parsed.returnItems) {
    const existing = await prisma.returnItem.findFirst({
      where: {
        userId,
        store: ri.store,
        purchaseDate: new Date(ri.purchaseDate),
        amountCents: ri.amountCents ?? null,
      },
    });

    if (existing) {
      returnItemsSkipped++;
    } else {
      if (apply) {
        await prisma.returnItem.create({
          data: {
            userId,
            store: ri.store,
            itemNote: ri.itemNote,
            amountCents: ri.amountCents,
            currency: ri.currency,
            purchaseDate: new Date(ri.purchaseDate),
            returnWindowDays: ri.returnWindowDays,
            returnBy: new Date(ri.returnBy),
            status: ri.status,
            trackingNumber: ri.trackingNumber,
            carrier: ri.carrier,
            dropoffDate: ri.dropoffDate ? new Date(ri.dropoffDate) : null,
            deliveredAt: ri.deliveredAt ? new Date(ri.deliveredAt) : null,
            refundExpectedAt: ri.refundExpectedAt ? new Date(ri.refundExpectedAt) : null,
            refundedDate: ri.refundedDate ? new Date(ri.refundedDate) : null,
            refundAmountCents: ri.refundAmountCents,
            refundSlaDays: ri.refundSlaDays,
            refundType: ri.refundType,
            shipmentEvents: {
              create: ri.shipmentEvents.map(se => ({
                userId,
                statusCode: se.statusCode,
                statusText: se.statusText,
                occurredAt: new Date(se.occurredAt),
                location: se.location,
                raw: se.raw ?? undefined,
              })),
            },
            refundCase: ri.refundCase ? {
              create: {
                userId,
                expectedAt: ri.refundCase.expectedAt ? new Date(ri.refundCase.expectedAt) : null,
                receivedAt: ri.refundCase.receivedAt ? new Date(ri.refundCase.receivedAt) : null,
                overdueNotifiedAt: ri.refundCase.overdueNotifiedAt ? new Date(ri.refundCase.overdueNotifiedAt) : null,
                refundType: ri.refundCase.refundType,
              }
            } : undefined,
          },
        });
      }
      returnItemsCreated++;
    }
  }

  for (const ve of parsed.valueEvents) {
    const existing = await prisma.valueEvent.findFirst({
      where: {
        userId,
        type: ve.type,
        occurredAt: new Date(ve.occurredAt),
        amountCents: ve.amountCents,
      },
    });

    if (existing) {
      valueEventsSkipped++;
    } else {
      if (apply) {
        await prisma.valueEvent.create({
          data: {
            userId,
            type: ve.type,
            amountCents: ve.amountCents,
            currency: ve.currency,
            occurredAt: new Date(ve.occurredAt),
            isEstimated: ve.isEstimated,
          },
        });
      }
      valueEventsCreated++;
    }
  }

  return {
    returnItems: { created: returnItemsCreated, skipped: returnItemsSkipped },
    valueEvents: { created: valueEventsCreated, skipped: valueEventsSkipped },
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      email: { type: "string" },
      apply: { type: "boolean", default: false },
    },
    args: process.argv.slice(2),
  });

  if (!values.file || !values.email) {
    console.error("Usage: npx tsx scripts/importLooplyExport.ts --file <path> --email <owner email> [--apply]");
    process.exit(1);
  }

  console.log(`Starting Looply import (dry run: ${!values.apply})`);
  console.log(`File: ${values.file}`);
  console.log(`Email: ${values.email}`);

  const prisma = new PrismaClient();

  try {
    const user = await prisma.user.findUnique({
      where: { email: values.email },
    });

    if (!user) {
      console.error(`Error: User with email ${values.email} not found.`);
      process.exit(1);
    }

    const fileContent = await fs.readFile(values.file, "utf8");
    const json = JSON.parse(fileContent);

    const stats = await processExport(prisma, user.id, json, values.apply ?? false);

    console.log("\nImport plan / results:");
    console.log(`  ReturnItems: ${stats.returnItems.created} to create, ${stats.returnItems.skipped} skipped (already exist)`);
    console.log(`  ValueEvents: ${stats.valueEvents.created} to create, ${stats.valueEvents.skipped} skipped (already exist)`);
    
    if (!values.apply) {
      console.log("\nThis was a DRY RUN. Pass --apply to actually write to the database.");
    }
  } catch (error) {
    console.error("Error during import:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run main if this file is the entry point
const isMain = process.argv[1] && process.argv[1].includes('importLooplyExport.ts');
if (isMain) {
  main().catch(console.error);
}
