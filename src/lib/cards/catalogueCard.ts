import { browsableCards, cardCatalogue, type CardCredit, type CardProduct } from "@/lib/contracts/cardCatalogue";
import { toReporting } from "@/engine/cards-twin/reportingCurrency";
import type { Network } from "./types";

/**
 * Card semantics read from PickMe's catalogue, keyed by `CreditCard.contractCardId`.
 *
 * This module replaced `src/lib/cards/presets.ts` + `CreditCard.rewards`, which
 * were a second, hand-authored rate model for the same 27 cards — weaker than
 * the catalogue (no MCC, country, channel, accountYear caps, postCapEarn, FX
 * allowances or effective-dating) and carrying no issuer provenance. See
 * docs/superpowers/specs/2026-08-19-card-identity-collapse-design.md.
 *
 * The split this file enforces: the catalogue says what the CARD is; the
 * `CreditCard` row says what YOUR COPY of it is (nickname, limit, statement
 * day, the fee you actually pay). Nothing rate-shaped is ever stored per user.
 */

const CARDS_BY_ID = new Map<string, CardProduct>(cardCatalogue.cards.map((card) => [card.cardId, card]));

const NETWORK_TO_DB: Record<CardProduct["network"], Network> = {
  amex: "AMEX",
  visa: "VISA",
  mastercard: "MASTERCARD",
  discover: "DISCOVER",
};

/// Null for a legacy or unlinked row. That is a real state, not an error: the
/// card exists and the UI asks the user to link it rather than guessing which
/// product it is — a wrong auto-match would silently rescore their spend.
export function catalogueCard(contractCardId: string | null | undefined): CardProduct | null {
  if (!contractCardId) return null;
  return CARDS_BY_ID.get(contractCardId) ?? null;
}

/// Absence of credits means the card grants none — never "unknown".
export function catalogueCredits(contractCardId: string | null | undefined): CardCredit[] {
  return catalogueCard(contractCardId)?.credits ?? [];
}

/// The issuer's own words about a fee waiver, where there are any. Shown
/// instead of a number because issuers offer tiers: the catalogue records that
/// Scotia's Ultimate package can rebate up to $150 while Preferred rebates $40,
/// and flattening that to one figure — as the retired preset model did — states
/// something the issuer does not.
export function feeWaiverNote(contractCardId: string | null | undefined): string | null {
  return catalogueCard(contractCardId)?.fee.waiver ?? null;
}

const MONTH_DAY = /^(\d{2})-(\d{2})$/;

/**
 * The redemption window used to be silently calendar-year for every annual
 * credit. Issuers such as Amex Platinum and BMO eclipse instead reset on the
 * card anniversary. `feeMonthDay` is the owner-confirmed anniversary proxy;
 * without it an account-year credit remains intentionally untracked rather
 * than being attributed to an invented calendar window.
 */
export function resolveCreditPeriod(credit: CardCredit): "calendarMonth" | "calendarQuarter" | "calendarYear" | "accountYear" {
  if (credit.period) return credit.period;
  if (credit.schedule?.basis === "accountAnniversary") return "accountYear";
  if (credit.schedule?.unit === "month") return "calendarMonth";
  if (credit.schedule?.unit === "quarter") return "calendarQuarter";
  return "calendarYear";
}

export function creditPeriodKey(
  period: CardCredit["period"] | "calendarQuarter",
  asOf: string,
  feeMonthDay: string | null | undefined,
): string | null {
  if (period === "calendarMonth") return asOf.slice(0, 7);
  if (period === "calendarQuarter") return `${asOf.slice(0, 4)}-Q${Math.ceil(Number(asOf.slice(5, 7)) / 3)}`;
  if (period === "calendarYear") return asOf.slice(0, 4);

  const match = feeMonthDay ? MONTH_DAY.exec(feeMonthDay) : null;
  if (!match) return null;
  const anchorMonth = Number(match[1]);
  const anchorDay = Number(match[2]);
  if (anchorMonth < 1 || anchorMonth > 12 || anchorDay < 1 || anchorDay > 31) return null;

  const asOfMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (!asOfMatch) return null;
  const year = Number(asOfMatch[1]);
  const month = Number(asOfMatch[2]);
  const day = Number(asOfMatch[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const hasReachedAnniversary = month > anchorMonth || (month === anchorMonth && day >= anchorDay);
  return `${hasReachedAnniversary ? year : year - 1}-${match[1]}-${match[2]}`;
}

export interface RedeemedCredit {
  creditId: string;
  periodKey: string;
}

/// Credits count only once the owner says they used them. An unredeemed credit
/// is worth nothing to a net-value figure, and assuming otherwise would inflate
/// every premium card's standing against the fee it charges.
export function catalogueCreditsRealizedMinor(
  credits: CardCredit[],
  redeemed: RedeemedCredit[],
  today: string,
  feeMonthDay?: string | null,
): number {
  return credits.reduce((sum, credit) => {
    const period = resolveCreditPeriod(credit);
    const key = creditPeriodKey(period, today, feeMonthDay);
    if (!key) return sum;
    const wasRedeemed = redeemed.some((r) => r.creditId === credit.creditId && r.periodKey === key);
    // Math.round, not truncation: 14.99 * 100 is 1498.9999... in binary float,
    // and a monthly credit that quietly loses a cent every month is a bug that
    // only shows up in a yearly total. toReporting converts the credit's own currency (USD for a
    // US card) into the engine's CAD reporting figure; identity for every CAD-billing card today.
    return sum + (wasRedeemed ? Math.round(toReporting(credit.value) * 100) : 0);
  }, 0);
}

/// The fee the owner actually pays. The rebate is the OWNER's fact — what their
/// bank package actually gives them — not a property of the card, which is why
/// it lives on `CreditCard` and not in the catalogue.
export function effectiveAnnualFeeMinor(annualFeeMinor: number, feeRebateMinor: number): number {
  return Math.max(0, annualFeeMinor - feeRebateMinor);
}

export interface CatalogueChoice {
  contractCardId: string;
  officialName: string;
  issuer: string;
  network: Network;
  market: CardProduct["market"];
  billingCurrency: CardProduct["billingCurrency"];
  status: "published" | "draft";
  annualFeeMinor: number;
}

export interface CardPerksSummary {
  programName: string;
  programUnit: string;
  topMultipliers: Array<{ earnText: string; categoryText: string }>;
  credits: Array<{ label: string; valueCad: number; period: string }>;
  fxRatePct: number;
  hasZeroFx: boolean;
  waiverNote: string | null;
}

const PROGRAM_DISPLAY_NAMES: Record<string, string> = {
  amexMembershipRewards: "Membership Rewards",
  aeroplan: "Aeroplan",
  scotiaScenePlus: "Scene+ Rewards",
  rbcAvion: "RBC Avion Rewards",
  cibcRewards: "CIBC Rewards",
  bmoRewards: "BMO Rewards",
  tdRewards: "TD Rewards",
  rogersBank: "Rogers Cash Back",
  tangerineCashback: "Tangerine Cash Back",
  triangleRewards: "Triangle Rewards",
  mbnaRewards: "MBNA Rewards",
  pcOptimum: "PC Optimum",
  cashback: "Cash Back",
  marriottBonvoy: "Marriott Bonvoy",
};

export function getCardPerksSummary(contractCardId: string | null | undefined): CardPerksSummary | null {
  const card = catalogueCard(contractCardId);
  if (!card) return null;

  const topMultipliers: Array<{ earnText: string; categoryText: string }> = [];
  for (const rule of card.earnRules) {
    let earnText = "";
    if (rule.earn.type === "points") {
      earnText = `${rule.earn.pointsPerUnit}x`;
    } else if (rule.earn.type === "cashback") {
      const ratePct = rule.earn.rate * 100;
      earnText = `${ratePct % 1 === 0 ? ratePct.toFixed(0) : ratePct.toFixed(1)}%`;
    } else if (rule.earn.type === "centsPerLitre") {
      earnText = `${rule.earn.premiumCentsPerLitre ?? rule.earn.otherCentsPerLitre ?? 0}¢/L`;
    }

    const cats = rule.predicate.categories ?? [];
    const categoryText = cats.length > 0
      ? cats.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(", ")
      : "All spend";

    topMultipliers.push({ earnText, categoryText });
  }

  // Sort multipliers so highest rates appear first
  topMultipliers.sort((a, b) => {
    const numA = parseFloat(a.earnText) || 0;
    const numB = parseFloat(b.earnText) || 0;
    return numB - numA;
  });

  const credits = (card.credits ?? []).map(c => ({
    label: c.label,
    // Converted to the CAD reporting figure — identity for every CAD-billing card today, which
    // is every card in the catalogue as of this writing. See toReporting's doc comment.
    valueCad: toReporting(c.value),
    period: (c.period === "calendarMonth" || c.schedule?.unit === "month") ? "month" : "year",
  }));

  const fxRate = card.fxRules[0]?.rate ?? 0.025;
  const fxRatePct = Math.round(fxRate * 1000) / 10;
  const hasZeroFx = fxRate === 0;

  const rawProg = card.program.programId;
  const programName = PROGRAM_DISPLAY_NAMES[rawProg] ?? (rawProg.charAt(0).toUpperCase() + rawProg.slice(1));

  return {
    programName,
    programUnit: card.program.unit === "cashback" ? "Cash Back" : "Points",
    topMultipliers: topMultipliers.slice(0, 4),
    credits,
    fxRatePct,
    hasZeroFx,
    waiverNote: card.fee.waiver ?? null,
  };
}

export const POPULAR_CARD_IDS = [
  "amex-cobalt",
  "scotia-gold-amex",
  "td-aeroplan-vi",
  "rogers-red-we",
  "tangerine-money-back-we",
  "amex-platinum",
  "scotia-passport-visa-infinite-plus",
  "rbc-avion-vi",
];

/// The add-card picker's options. Deliberately carries identity and fee only —
/// no rates, caps or multipliers are ever copied onto a user's row, because
/// copying them is precisely how the two rate models diverged in the first place.
export function catalogueChoices(): CatalogueChoice[] {
  // `browsableCards()` is safe here because CardPicker is market-scoped and
  // renders an explicit unverified treatment for drafts. Do not reuse this
  // helper for linking or validation; those must stay published-only.
  return browsableCards()
    .map((card) => ({
      contractCardId: card.cardId,
      officialName: card.officialName,
      issuer: card.issuer,
      network: NETWORK_TO_DB[card.network],
      market: card.market,
      billingCurrency: card.billingCurrency,
      status: card.status ?? "published",
      // Preserve the catalogue's native billing currency. Converting a US fee
      // at browse time is exactly the silent CAD claim this flow exists to end.
      annualFeeMinor: Math.round((card.fee.annual?.amount ?? 0) * 100),
    }))
    .sort((a, b) =>
      a.issuer === b.issuer ? a.officialName.localeCompare(b.officialName) : a.issuer.localeCompare(b.issuer),
    );
}
