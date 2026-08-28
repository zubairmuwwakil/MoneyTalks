import { z } from "zod";
import billIntermediariesRaw from "../../../contracts/bill-intermediaries.json";

export const BillIntermediarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum([
    "creditIntermediary",
    "cardDirectBillPay",
    "fintechAccountRouting",
    "standardEft",
  ]),
  feeRate: z.number().nonnegative(),
  mccTrigger: z.string().optional(),
  directRewardRate: z.number().nonnegative().optional(),
  directRewardProgramId: z.string().optional(),
  holdingApy: z.number().nonnegative().optional(),
  hasPartnerPerks: z.boolean().optional(),
  settlementDays: z.number().int().nonnegative(),
  restrictedCardPrograms: z.array(z.string()).optional(),
  supportedCategories: z.array(z.string()),
  requiresCardMultiplier: z.boolean().optional(),
  description: z.string().min(1),
});

export const BillIntermediariesCatalogueSchema = z.object({
  billIntermediariesVersion: z.string().regex(/^[0-9]+\.[0-9]+$/),
  intermediaries: z.array(BillIntermediarySchema),
});

export type BillIntermediary = z.infer<typeof BillIntermediarySchema>;
export type BillIntermediariesCatalogue = z.infer<typeof BillIntermediariesCatalogueSchema>;

export const billIntermediariesCatalogue = BillIntermediariesCatalogueSchema.parse(billIntermediariesRaw);
export const billIntermediaries = billIntermediariesCatalogue.intermediaries;
