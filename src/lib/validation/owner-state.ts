import { z } from "zod";

const finiteNonNegative = z.number().finite().min(0);

const pointValuation = z.object({
  centsPerPoint: finiteNonNegative,
  floorCentsPerPoint: finiteNonNegative.optional(),
  aspirationalCentsPerPoint: finiteNonNegative.optional(),
  low: finiteNonNegative.optional(),
  high: finiteNonNegative.optional(),
  basis: z.string().optional(),
}).strict();

const ctMoneyValuation = z.object({
  cadPerUnit: finiteNonNegative,
  optionalUsabilityFactor: finiteNonNegative,
  usabilityFactorApplied: z.boolean(),
  basis: z.string().optional(),
}).strict();

const legacyCroValuation = z.object({
  model: z.string().min(1),
  faceValueFactorIfAutoSold: finiteNonNegative,
  defaultHeldRiskFactor: finiteNonNegative,
  basis: z.string().optional(),
}).strict();

const cashBackValuation = z.object({
  cadPerDollar: finiteNonNegative,
  basis: z.string().optional(),
}).strict();

const legacyValuations = z.object({
  amexMembershipRewards: pointValuation,
  marriottBonvoy: pointValuation,
  mbnaRewards: pointValuation,
  ctMoney: ctMoneyValuation,
  cro: legacyCroValuation,
  cashBack: cashBackValuation,
}).strict();

const storedLegacyValuations = legacyValuations.extend({
  cro: z.union([
    legacyCroValuation,
    z.object({
      redemptionModel: z.string().min(1),
      faceValueFactorIfAutoSold: finiteNonNegative,
      defaultHeldRiskFactor: finiteNonNegative,
      basis: z.string().optional(),
    }).strict(),
  ]).transform((cro) => {
    if ("model" in cro) return cro;
    const { redemptionModel, ...rest } = cro;
    return { model: redemptionModel, ...rest };
  }),
}).passthrough();

const programValuation = z.discriminatedUnion("model", [
  pointValuation.extend({ model: z.literal("points") }),
  ctMoneyValuation.extend({ model: z.literal("ctMoney") }),
  z.object({
    model: z.literal("cro"),
    redemptionModel: z.string().min(1),
    faceValueFactorIfAutoSold: finiteNonNegative,
    defaultHeldRiskFactor: finiteNonNegative,
    basis: z.string().optional(),
  }).strict(),
  cashBackValuation.extend({ model: z.literal("cashback") }),
]);

const programsDictionary = z.record(z.string().min(1), programValuation);

const requiredProgramModels = {
  amexMembershipRewards: "points",
  marriottBonvoy: "points",
  mbnaRewards: "points",
  ctMoney: "ctMoney",
  cro: "cro",
  cashback: "cashback",
} as const;

const modernValuations = z.object({ programs: programsDictionary }).strict().superRefine((value, ctx) => {
  for (const [programId, model] of Object.entries(requiredProgramModels)) {
    if (value.programs[programId]?.model !== model) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["programs", programId],
        message: `required ${model} valuation is missing`,
      });
    }
  }
});

type LegacyValuations = z.infer<typeof legacyValuations>;
type ProgramsDictionary = z.infer<typeof programsDictionary>;

function programsFromLegacy(legacy: LegacyValuations): ProgramsDictionary {
  return {
    amexMembershipRewards: { model: "points", ...legacy.amexMembershipRewards },
    marriottBonvoy: { model: "points", ...legacy.marriottBonvoy },
    mbnaRewards: { model: "points", ...legacy.mbnaRewards },
    ctMoney: { model: "ctMoney", ...legacy.ctMoney },
    cro: {
      model: "cro",
      redemptionModel: legacy.cro.model,
      faceValueFactorIfAutoSold: legacy.cro.faceValueFactorIfAutoSold,
      defaultHeldRiskFactor: legacy.cro.defaultHeldRiskFactor,
      ...(legacy.cro.basis === undefined ? {} : { basis: legacy.cro.basis }),
    },
    cashback: { model: "cashback", ...legacy.cashBack },
  };
}

function legacyFromPrograms(programs: ProgramsDictionary): LegacyValuations {
  const points = (programId: "amexMembershipRewards" | "marriottBonvoy" | "mbnaRewards") => {
    const program = programs[programId] as z.infer<typeof pointValuation> & { model: "points" };
    return {
      centsPerPoint: program.centsPerPoint,
      ...(program.floorCentsPerPoint === undefined ? {} : { floorCentsPerPoint: program.floorCentsPerPoint }),
      ...(program.aspirationalCentsPerPoint === undefined
        ? {}
        : { aspirationalCentsPerPoint: program.aspirationalCentsPerPoint }),
      ...(program.low === undefined ? {} : { low: program.low }),
      ...(program.high === undefined ? {} : { high: program.high }),
      ...(program.basis === undefined ? {} : { basis: program.basis }),
    };
  };
  const ctProgram = programs.ctMoney as z.infer<typeof ctMoneyValuation> & { model: "ctMoney" };
  const croProgram = programs.cro as {
    model: "cro";
    redemptionModel: string;
    faceValueFactorIfAutoSold: number;
    defaultHeldRiskFactor: number;
    basis?: string;
  };
  const cashProgram = programs.cashback as z.infer<typeof cashBackValuation> & {
    model: "cashback";
  };
  return {
    amexMembershipRewards: points("amexMembershipRewards"),
    marriottBonvoy: points("marriottBonvoy"),
    mbnaRewards: points("mbnaRewards"),
    ctMoney: {
      cadPerUnit: ctProgram.cadPerUnit,
      optionalUsabilityFactor: ctProgram.optionalUsabilityFactor,
      usabilityFactorApplied: ctProgram.usabilityFactorApplied,
      ...(ctProgram.basis === undefined ? {} : { basis: ctProgram.basis }),
    },
    cro: {
      model: croProgram.redemptionModel,
      faceValueFactorIfAutoSold: croProgram.faceValueFactorIfAutoSold,
      defaultHeldRiskFactor: croProgram.defaultHeldRiskFactor,
      ...(croProgram.basis === undefined ? {} : { basis: croProgram.basis }),
    },
    cashBack: {
      cadPerDollar: cashProgram.cadPerDollar,
      ...(cashProgram.basis === undefined ? {} : { basis: cashProgram.basis }),
    },
  };
}

function hybridValuations(value: LegacyValuations | z.infer<typeof modernValuations>) {
  const programs = "programs" in value ? value.programs : programsFromLegacy(value);
  return { ...legacyFromPrograms(programs), programs };
}

/// The database keeps legacy fields for the current web scoring engine plus the modern dictionary
/// for PickMe. API reads expose only the modern representation, so `model` is never ambiguous.
export function ownerStateForWire(state: unknown): unknown {
  if (state === null || typeof state !== "object" || Array.isArray(state)) return state;
  const ownerState = state as Record<string, unknown>;
  const rawValuations = ownerState.valuationsCad;
  if (rawValuations === null || typeof rawValuations !== "object" || Array.isArray(rawValuations)) return state;

  const programs = programsDictionary.safeParse((rawValuations as Record<string, unknown>).programs);
  if (programs.success) return { ...ownerState, valuationsCad: { programs: programs.data } };

  const legacy = storedLegacyValuations.safeParse(rawValuations);
  if (!legacy.success) return state;
  return { ...ownerState, valuationsCad: { programs: programsFromLegacy(legacy.data) } };
}

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
  valuationsCad: z.union([legacyValuations, modernValuations]).transform(hybridValuations),
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
