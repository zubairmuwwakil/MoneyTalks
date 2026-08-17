import { z } from "zod";

const finiteNonNegative = z.number().finite().min(0);

const cardState = z.object({
  capProgress: z.record(z.string().min(1), finiteNonNegative).optional(),
  scotiaAccountYearAnchorMonth: z.number().int().min(1).max(12).optional(),
  selectedCategories: z.array(z.string().min(1)).optional(),
  treatAsAllSelected: z.boolean().optional(),
  thirdCategoryUnlocked: z.boolean().optional(),
  nextChangeEffectiveDate: z.string().optional(),
  rogersEligibleServiceLinked: z.boolean().optional(),
  rogersAccountAnniversaryMonth: z.number().int().min(1).max(12).optional(),
  feeWaiverActive: z.boolean().optional(),
  cryptoLevelUpProActive: z.boolean().optional(),
  croHandling: z.enum(["autoSell", "hold"]).optional(),
}).strict();

export const ownerStateInput = z.object({
  ownerStateVersion: z.string().min(1).max(100),
  ownedCardIds: z.array(z.string().min(1)).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, "duplicate card"),
  defaultCardId: z.string().min(1),
  switchThreshold: z.object({
    minAdvantagePercentagePoints: finiteNonNegative,
    minAdvantageCad: finiteNonNegative,
    semantics: z.enum(["both", "either"]),
  }).strict(),
  carry: z.object({ drawerCards: z.array(z.string().min(1)).max(100) }).strict(),
  cardStates: z.record(z.string().min(1), cardState),
  valuationsCad: z.object({
    amexMembershipRewards: z.object({
      centsPerPoint: finiteNonNegative, floorCentsPerPoint: finiteNonNegative.optional(),
      aspirationalCentsPerPoint: finiteNonNegative.optional(), low: finiteNonNegative.optional(),
      high: finiteNonNegative.optional(), basis: z.string().optional(),
    }).strict(),
    marriottBonvoy: z.object({
      centsPerPoint: finiteNonNegative, floorCentsPerPoint: finiteNonNegative.optional(),
      aspirationalCentsPerPoint: finiteNonNegative.optional(), low: finiteNonNegative.optional(),
      high: finiteNonNegative.optional(), basis: z.string().optional(),
    }).strict(),
    mbnaRewards: z.object({
      centsPerPoint: finiteNonNegative, floorCentsPerPoint: finiteNonNegative.optional(),
      aspirationalCentsPerPoint: finiteNonNegative.optional(), low: finiteNonNegative.optional(),
      high: finiteNonNegative.optional(), basis: z.string().optional(),
    }).strict(),
    ctMoney: z.object({ cadPerUnit: finiteNonNegative, optionalUsabilityFactor: finiteNonNegative,
      usabilityFactorApplied: z.boolean() }).strict(),
    cro: z.object({ model: z.string().min(1), faceValueFactorIfAutoSold: finiteNonNegative,
      defaultHeldRiskFactor: finiteNonNegative }).strict(),
    cashBack: z.object({ cadPerDollar: finiteNonNegative }).strict(),
  }).strict(),
}).strict().superRefine((state, ctx) => {
  if (!state.ownedCardIds.includes(state.defaultCardId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultCardId"], message: "default card must be owned" });
  }
  for (const cardId of Object.keys(state.cardStates)) {
    if (!state.ownedCardIds.includes(cardId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cardStates", cardId], message: "card state must be owned" });
    }
  }
});
