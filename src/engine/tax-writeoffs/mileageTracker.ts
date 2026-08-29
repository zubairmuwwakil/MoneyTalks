/**
 * CRA Prescribed Automobile Mileage Allowance Engine
 *
 * Implements the official Canada Revenue Agency prescribed per-kilometre rates
 * for business travel deductions (Form T2125 Line 9281 / Form T777).
 */

export interface MileageTrip {
  id: string;
  date: string;
  purpose: string;
  origin?: string;
  destination?: string;
  distanceKm: number;
  notes?: string;
}

export interface MileageRateTier {
  first5000KmRate: number; // Dollars per km
  subsequentKmRate: number; // Dollars per km
}

export const CRA_MILEAGE_RATES_2026: Record<"PROVINCES" | "TERRITORIES", MileageRateTier> = {
  PROVINCES: {
    first5000KmRate: 0.7, // 70¢ / km
    subsequentKmRate: 0.64, // 64¢ / km
  },
  TERRITORIES: {
    first5000KmRate: 0.74, // 74¢ / km (Yukon, NWT, Nunavut)
    subsequentKmRate: 0.68, // 68¢ / km
  },
};

export interface MileageCalculationResult {
  totalBusinessKm: number;
  tier1Km: number;
  tier1Rate: number;
  tier1AmountMinor: number;
  tier2Km: number;
  tier2Rate: number;
  tier2AmountMinor: number;
  totalAllowanceMinor: number;
  craForm: string;
  craLine: string;
  citation: string;
}

/**
 * Computes the official CRA vehicle mileage deduction allowance based on total business kilometres.
 */
export function calculateMileageAllowance({
  totalBusinessKm,
  isTerritory = false,
}: {
  totalBusinessKm: number;
  isTerritory?: boolean;
}): MileageCalculationResult {
  const km = Math.max(0, totalBusinessKm);
  const rates = isTerritory ? CRA_MILEAGE_RATES_2026.TERRITORIES : CRA_MILEAGE_RATES_2026.PROVINCES;

  const tier1Km = Math.min(km, 5000);
  const tier2Km = Math.max(0, km - 5000);

  const tier1AmountMinor = Math.round(tier1Km * rates.first5000KmRate * 100);
  const tier2AmountMinor = Math.round(tier2Km * rates.subsequentKmRate * 100);
  const totalAllowanceMinor = tier1AmountMinor + tier2AmountMinor;

  return {
    totalBusinessKm: km,
    tier1Km,
    tier1Rate: rates.first5000KmRate,
    tier1AmountMinor,
    tier2Km,
    tier2Rate: rates.subsequentKmRate,
    tier2AmountMinor,
    totalAllowanceMinor,
    craForm: "T2125",
    craLine: "9281",
    citation: "CRA Form T2125 Line 9281 & Automobile Allowance Rates (Income Tax Regulations 7306)",
  };
}
