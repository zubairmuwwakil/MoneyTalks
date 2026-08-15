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
