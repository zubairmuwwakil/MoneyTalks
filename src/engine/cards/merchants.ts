import type { Network, SpendCategory } from "./types";

export interface MerchantFact {
  name: string;
  category: SpendCategory;
  networkRestriction?: Network;
  amexAccepted?: boolean;
  note?: string;
}

// Public Canadian retail facts. Acceptance changes, so the UI hedges with "verify at the till".
export const MERCHANTS: MerchantFact[] = [
  {
    name: "Costco (in-store)",
    category: "warehouse",
    networkRestriction: "MASTERCARD",
    note: "Mastercard only in-store in Canada",
  },
  { name: "Costco.ca (online)", category: "warehouse", note: "Online accepts more networks than in-store" },
  { name: "No Frills", category: "groceries", amexAccepted: false, note: "Generally does not accept Amex" },
  { name: "Food Basics", category: "groceries", note: "Acceptance evidence is mixed; verify at the till" },
  { name: "Loblaws", category: "groceries" },
  { name: "Metro", category: "groceries" },
  { name: "Walmart", category: "everything_else", note: "Often not coded as grocery MCC" },
  { name: "Canadian Tire", category: "home_improvement" },
  { name: "Home Depot", category: "home_improvement" },
  { name: "Uber Eats", category: "dining" },
  { name: "Tim Hortons", category: "dining" },
  { name: "Petro-Canada", category: "gas" },
  { name: "Esso", category: "gas" },
  { name: "Netflix", category: "streaming" },
  { name: "Spotify", category: "streaming" },
  { name: "Marriott", category: "hotel" },
  { name: "Air Canada", category: "travel" },
  { name: "Amazon.ca", category: "everything_else" },
];

export function matchMerchant(query: string): MerchantFact[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  return MERCHANTS.filter((m) => m.name.toLowerCase().includes(q));
}

/** Lowercases a merchant name and strips a trailing parenthetical, e.g. "Costco (in-store)" -> "costco". */
function normalizeMerchantName(name: string): string {
  return name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * Finds the merchant fact whose (normalized) name appears inside a
 * statement description line, e.g. "NO FRILLS #123" -> the "No Frills"
 * fact. This is the inverse direction of `matchMerchant`, which matches
 * merchant names containing a search query — a statement line contains the
 * brand name plus store-specific noise (store numbers, order ids), so the
 * containment direction must flip. Requires at least 4 characters to guard
 * against short names matching incidental substrings. When multiple facts
 * match, the longest normalized name wins (e.g. "COSTCO.CA ORDER 88"
 * resolves to "Costco.ca (online)", not "Costco (in-store)").
 */
export function matchMerchantInDescription(description: string): MerchantFact | null {
  const d = description.toLowerCase();
  let best: MerchantFact | null = null;
  let bestLen = 0;
  for (const m of MERCHANTS) {
    const normalized = normalizeMerchantName(m.name);
    if (normalized.length < 4) continue;
    if (d.includes(normalized) && normalized.length > bestLen) {
      best = m;
      bestLen = normalized.length;
    }
  }
  return best;
}
