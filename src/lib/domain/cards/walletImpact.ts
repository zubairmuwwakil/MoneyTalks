import { effectiveAnnualFeeMinor, type RedeemedCredit } from "@/lib/cards/catalogueCard";

export interface WalletImpactCredit {
  creditId: string;
  valueCad: number;
  period: "calendarMonth" | "calendarYear" | "accountYear";
}

export interface WalletImpactCardInput {
  id: string;
  nickname: string;
  issuer: string;
  annualFeeMinor: number;
  feeRebateMinor: number;
  rewardsEstimateMinor: number;
  credits: WalletImpactCredit[];
  redeemed: RedeemedCredit[];
}

export type WalletImpactStatus = "ahead" | "short" | "even" | "no-fee";

export interface WalletImpactRow {
  id: string;
  nickname: string;
  issuer: string;
  realizedMinor: number;
  feeMinor: number;
  netMinor: number;
  status: WalletImpactStatus;
  valuePct: number;
  feePct: number;
}

export interface WalletImpactView {
  year: number;
  rows: WalletImpactRow[];
  totalRealizedMinor: number;
  totalFeeMinor: number;
  totalNetMinor: number;
  breakEvenCount: number;
  feeCardCount: number;
}

function realizedCreditMinor(
  credits: WalletImpactCredit[],
  redeemed: RedeemedCredit[],
  year: number,
): number {
  const creditsById = new Map(credits.map((credit) => [credit.creditId, credit]));
  const seen = new Set<string>();
  let totalMinor = 0;

  for (const redemption of redeemed) {
    if (!redemption.periodKey.startsWith(String(year))) continue;
    const credit = creditsById.get(redemption.creditId);
    if (!credit) continue;
    const key = `${redemption.creditId}:${redemption.periodKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    totalMinor += Math.round(credit.valueCad * 100);
  }

  return totalMinor;
}

function rowFor(card: WalletImpactCardInput, year: number): WalletImpactRow {
  const feeMinor = effectiveAnnualFeeMinor(card.annualFeeMinor, card.feeRebateMinor);
  const realizedMinor = card.rewardsEstimateMinor + realizedCreditMinor(card.credits, card.redeemed, year);
  const netMinor = realizedMinor - feeMinor;
  const status: WalletImpactStatus = feeMinor === 0
    ? "no-fee"
    : netMinor > 0
      ? "ahead"
      : netMinor < 0
        ? "short"
        : "even";
  const scaleMinor = Math.max(realizedMinor, feeMinor, 1);

  return {
    id: card.id,
    nickname: card.nickname,
    issuer: card.issuer,
    realizedMinor,
    feeMinor,
    netMinor,
    status,
    valuePct: feeMinor === 0 ? 100 : Math.round((realizedMinor / scaleMinor) * 100),
    feePct: feeMinor === 0 ? 0 : Math.round((feeMinor / scaleMinor) * 100),
  };
}

export function buildWalletImpact(cards: WalletImpactCardInput[], year: number): WalletImpactView {
  const rows = cards
    .map((card) => rowFor(card, year))
    .sort((a, b) => a.netMinor - b.netMinor || a.nickname.localeCompare(b.nickname));
  const feeCardCount = rows.filter((row) => row.feeMinor > 0).length;
  const breakEvenCount = rows.filter((row) => row.feeMinor > 0 && row.netMinor >= 0).length;
  const totalRealizedMinor = rows.reduce((sum, row) => sum + row.realizedMinor, 0);
  const totalFeeMinor = rows.reduce((sum, row) => sum + row.feeMinor, 0);

  return {
    year,
    rows,
    totalRealizedMinor,
    totalFeeMinor,
    totalNetMinor: totalRealizedMinor - totalFeeMinor,
    breakEvenCount,
    feeCardCount,
  };
}
