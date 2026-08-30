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

const merchantCreditValuation = z.object({
  cadPerUnit: finiteNonNegative,
  optionalUsabilityFactor: finiteNonNegative,
  usabilityFactorApplied: z.boolean(),
  merchantScope: z.array(z.string().min(1)),
  basis: z.string().optional(),
}).strict();

const noRewardsValuation = z.object({
  basis: z.string().optional(),
}).strict();

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
  merchantCreditValuation.extend({ model: z.literal("merchantCredit") }),
  noRewardsValuation.extend({ model: z.literal("noRewards") }),
]);

const programsDictionary = z.record(z.string().min(1), programValuation);

const modernValuations = z.object({ programs: programsDictionary }).strict();

type LegacyValuations = z.infer<typeof legacyValuations>;
type ProgramsDictionary = z.infer<typeof programsDictionary>;

const DEFAULT_LEGACY_VALUATIONS: LegacyValuations = {
  amexMembershipRewards: {
    centsPerPoint: 1,
    floorCentsPerPoint: 1,
    aspirationalCentsPerPoint: 2.2,
    basis: "default cash floor",
  },
  marriottBonvoy: {
    centsPerPoint: 0.8,
    low: 0.6,
    high: 1,
    basis: "default",
  },
  mbnaRewards: {
    centsPerPoint: 1,
    floorCentsPerPoint: 0.833333,
    basis: "default cash floor",
  },
  ctMoney: {
    cadPerUnit: 1,
    optionalUsabilityFactor: 0.95,
    usabilityFactorApplied: true,
  },
  cro: {
    model: "reward-currency",
    faceValueFactorIfAutoSold: 1,
    defaultHeldRiskFactor: 0.8,
  },
  cashBack: {
    cadPerDollar: 1,
  },
};

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
    const program = programs[programId];
    if (program && program.model === "points") {
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
    }
    return DEFAULT_LEGACY_VALUATIONS[programId];
  };

  const ct = programs.ctMoney;
  const ctValuation =
    ct && ct.model === "ctMoney"
      ? {
          cadPerUnit: ct.cadPerUnit,
          optionalUsabilityFactor: ct.optionalUsabilityFactor,
          usabilityFactorApplied: ct.usabilityFactorApplied,
          ...(ct.basis === undefined ? {} : { basis: ct.basis }),
        }
      : DEFAULT_LEGACY_VALUATIONS.ctMoney;

  const cro = programs.cro;
  const croValuation =
    cro && cro.model === "cro"
      ? {
          model: cro.redemptionModel,
          faceValueFactorIfAutoSold: cro.faceValueFactorIfAutoSold,
          defaultHeldRiskFactor: cro.defaultHeldRiskFactor,
          ...(cro.basis === undefined ? {} : { basis: cro.basis }),
        }
      : DEFAULT_LEGACY_VALUATIONS.cro;

  const cash = programs.cashback;
  const cashValuation =
    cash && cash.model === "cashback"
      ? {
          cadPerDollar: cash.cadPerDollar,
          ...(cash.basis === undefined ? {} : { basis: cash.basis }),
        }
      : DEFAULT_LEGACY_VALUATIONS.cashBack;

  return {
    amexMembershipRewards: points("amexMembershipRewards"),
    marriottBonvoy: points("marriottBonvoy"),
    mbnaRewards: points("mbnaRewards"),
    ctMoney: ctValuation,
    cro: croValuation,
    cashBack: cashValuation,
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
  capProgress: z.record(z.string().min(1), finiteNonNegative).nullable().optional(),
  scotiaAccountYearAnchorMonth: z.number().int().min(1).max(12).nullable().optional(),
  selectedCategories: z.array(z.string().min(1)).nullable().optional(),
  treatAsAllSelected: z.boolean().nullable().optional(),
  thirdCategoryUnlocked: z.boolean().nullable().optional(),
  nextChangeEffectiveDate: z.string().nullable().optional(),
  rogersEligibleServiceLinked: z.boolean().nullable().optional(),
  rogersAccountAnniversaryMonth: z.number().int().min(1).max(12).nullable().optional(),
  feeWaiverActive: z.boolean().nullable().optional(),
  cryptoLevelUpProActive: z.boolean().nullable().optional(),
  croHandling: z.enum(["autoSell", "hold"]).nullable().optional(),
  /// Owner-condition answers keyed by the catalogue's `ownerConditions` id — card-contracts@2.8's
  /// replacement for the two named booleans above, which PickMe still mirrors out of this
  /// dictionary for one release. Both representations are accepted; the mirror is what keeps the
  /// TS twin's RuleMatcher, which still reads the named fields, correct in the meantime.
  ///
  /// An ABSENT key is unresolved and the engine fails closed on it; `false` is a real "no". The
  /// two buy the owner different rates, so a non-boolean is refused rather than coerced.
  ///
  /// Keys are deliberately unconstrained rather than checked against the vendored
  /// `contracts/owner-conditions.json`. A condition PickMe ships before this repo re-vendors the
  /// contract must still persist: rejecting it would reproduce the exact outage this field was
  /// added to fix, one release later and with a slower feedback loop.
  flags: z.record(z.string().min(1), z.boolean()).nullable().optional(),
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
  /// The owner's own residency — see cards-twin/models.ts's OwnerState.market doc comment for
  /// why this gates only the empty-wallet acquisition/browse default, never ownedCardIds or
  /// checkout scoring. Absent means "unresolved", not "Canadian" — the engine applies that
  /// default itself (resolvedMarket), so it is never baked into the stored record.
  market: z.enum(["CA", "US"]).nullable().optional(),
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
