import type { AccountView, FinancialSnapshot, HoldingView, ProfileView, TxView } from "./types";

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function makeProfile(overrides: Partial<ProfileView> = {}): ProfileView {
  return {
    residency: "CA",
    citizenships: ["US", "CA"],
    filingStatus: "SINGLE_ABROAD",
    marginalUSRatePct: 24,
    dtcEligible: false,
    benefitPrograms: [],
    rdspIncomeTier: "UNKNOWN",
    rdspCarryForwardYears: 0,
    rdspGrantsLifetimeMinor: 0,
    rdspContribLifetimeMinor: 0,
    tfsaRoomMinor: 0,
    rrspRoomMinor: 0,
    fhsaRoomMinor: 0,
    nhtContributed: false,
    incomeSources: [],
    ...overrides,
  };
}

export function makeHolding(overrides: Partial<HoldingView> = {}): HoldingView {
  return {
    id: nextId("h"),
    symbol: "FICT",
    name: "Fictional Holding",
    domicileCountry: "CA",
    quantity: 1,
    bookCostMinor: null,
    lastPriceMinor: 100_00,
    priceAsOf: "2026-08-01",
    ...overrides,
  };
}

export function makeTx(overrides: Partial<TxView> = {}): TxView {
  return {
    id: nextId("t"),
    type: "CONTRIBUTION",
    amountMinor: 100_00,
    currency: "CAD",
    date: "2026-06-01",
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<AccountView> = {}): AccountView {
  return {
    id: nextId("a"),
    type: "TFSA",
    name: "Fixture Account",
    institution: "Fixture Trust",
    country: "CA",
    currency: "CAD",
    isUSSitus: false,
    balanceMinor: 0,
    balanceAsOf: null,
    holdings: [],
    transactions: [],
    snapshots: [],
    ...overrides,
  };
}

export function makeSnapshot(
  accounts: AccountView[],
  overrides: Partial<FinancialSnapshot> = {},
): FinancialSnapshot {
  return {
    today: "2026-08-14",
    accounts,
    fxRates: [{ base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-01" }],
    ...overrides,
  };
}
