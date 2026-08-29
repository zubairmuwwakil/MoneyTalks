import "server-only";

import { z } from "zod";

const BASE_URL = "https://api.payments.ca";
const ACCEPT = "application/vnd.ccin.api.v1+json";
const REQUEST_TIMEOUT_MS = 8_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().optional(),
});

const corporateCreditorSchema = z.object({
  ccin: z.string().min(1),
  shortname: z.string().min(1),
  status: z.enum(["A", "I", "D", "P"]),
  statusDate: z.string().optional(),
  cycleDate: z.string().optional(),
  provCode: z.string().optional(),
  countryCode: z.string().optional(),
  acceptableMediaType: z.enum(["1", "2"]).optional(),
  leadFiName: z.string().optional(),
});

const corporateCreditorListSchema = z.array(corporateCreditorSchema);

export type PaymentsCanadaEnvironment = "sandbox" | "production";

export interface CorporateCreditor {
  ccin: string;
  shortName: string;
  status: "ACTIVE" | "INACTIVE" | "DELETED" | "PENDING";
  statusDate: string | null;
  cycleDate: string | null;
  province: string | null;
  country: string | null;
  acceptsElectronic: boolean;
  leadFinancialInstitution: string | null;
  environment: PaymentsCanadaEnvironment;
}

export class PaymentsCanadaError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "AUTH_FAILED" | "REQUEST_FAILED" | "INVALID_RESPONSE",
  ) {
    super(message);
    this.name = "PaymentsCanadaError";
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function environment(): PaymentsCanadaEnvironment {
  return process.env.PAYMENTS_CANADA_ENV === "production" ? "production" : "sandbox";
}

function credentials(): { key: string; secret: string } {
  // Consumer_Key/Consumer_Secret are the names already present in the owner's
  // local file. The canonical uppercase names keep deployments and env checks
  // conventional while the fallback makes the existing setup work immediately.
  const key = process.env.PAYMENTS_CANADA_CONSUMER_KEY ?? process.env["Consumer_Key"];
  const secret = process.env.PAYMENTS_CANADA_CONSUMER_SECRET ?? process.env["Consumer_Secret"];
  if (!key || !secret) {
    throw new PaymentsCanadaError("Payments Canada credentials are not configured.", "NOT_CONFIGURED");
  }
  return { key, secret };
}

function apiBaseUrl(): string {
  return (process.env.PAYMENTS_CANADA_BASE_URL || BASE_URL).replace(/\/+$/, "");
}

function productPath(product: "lookup" | "extracts"): string {
  const suffix = environment() === "sandbox" ? "-sandbox" : "";
  return `ccin-${product}${suffix}`;
}

function statusLabel(status: z.infer<typeof corporateCreditorSchema>["status"]): CorporateCreditor["status"] {
  switch (status) {
    case "A": return "ACTIVE";
    case "I": return "INACTIVE";
    case "D": return "DELETED";
    case "P": return "PENDING";
  }
}

function toCorporateCreditor(
  raw: z.infer<typeof corporateCreditorSchema>,
): CorporateCreditor {
  return {
    ccin: raw.ccin,
    shortName: raw.shortname.trim(),
    status: statusLabel(raw.status),
    statusDate: raw.statusDate ?? null,
    cycleDate: raw.cycleDate ?? null,
    province: raw.provCode ?? null,
    country: raw.countryCode ?? null,
    acceptsElectronic: raw.acceptableMediaType === "2",
    leadFinancialInstitution: raw.leadFiName?.trim() || null,
    environment: environment(),
  };
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 15_000) return cachedToken.value;

  const { key, secret } = credentials();
  const response = await fetch(`${apiBaseUrl()}/accesstoken`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);

  if (!response?.ok) {
    throw new PaymentsCanadaError("Payments Canada authentication failed.", "AUTH_FAILED");
  }

  const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new PaymentsCanadaError("Payments Canada returned an invalid token response.", "INVALID_RESPONSE");
  }

  cachedToken = {
    value: parsed.data.access_token,
    expiresAt: Date.now() + Math.max(30, parsed.data.expires_in ?? 300) * 1_000,
  };
  return cachedToken.value;
}

async function authenticatedGet(url: URL): Promise<unknown> {
  const token = await accessToken();
  const response = await fetch(url, {
    headers: { Accept: ACCEPT, Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);

  if (!response?.ok) {
    if (response?.status === 401) cachedToken = null;
    throw new PaymentsCanadaError("Payments Canada biller lookup is unavailable.", "REQUEST_FAILED");
  }
  return response.json().catch(() => null);
}

export async function searchCorporateCreditors(query: string, limit = 8): Promise<CorporateCreditor[]> {
  const normalizedQuery = query.trim().slice(0, 80);
  if (normalizedQuery.length < 2) return [];

  const url = new URL(`${apiBaseUrl()}/${productPath("extracts")}/extracts/master`);
  url.searchParams.set("filter", normalizedQuery);
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 12)));
  url.searchParams.set("page", "0");
  url.searchParams.set("sortField", "shortname");
  url.searchParams.set("sortOrder", "true");

  const parsed = corporateCreditorListSchema.safeParse(await authenticatedGet(url));
  if (!parsed.success) {
    throw new PaymentsCanadaError("Payments Canada returned an invalid biller list.", "INVALID_RESPONSE");
  }

  return parsed.data
    .map(toCorporateCreditor)
    .sort((a, b) => (a.status === "ACTIVE" ? -1 : 1) - (b.status === "ACTIVE" ? -1 : 1));
}

export async function lookupCorporateCreditor(ccin: string): Promise<CorporateCreditor> {
  const normalized = ccin.trim();
  if (!/^\d{1,20}$/.test(normalized)) {
    throw new PaymentsCanadaError("The selected Payments Canada biller ID is invalid.", "REQUEST_FAILED");
  }

  const url = new URL(`${apiBaseUrl()}/${productPath("lookup")}/ccins/${encodeURIComponent(normalized)}`);
  const parsed = corporateCreditorSchema.safeParse(await authenticatedGet(url));
  if (!parsed.success) {
    throw new PaymentsCanadaError("Payments Canada returned an invalid biller record.", "INVALID_RESPONSE");
  }
  return toCorporateCreditor(parsed.data);
}

export function resetPaymentsCanadaTokenCacheForTests(): void {
  cachedToken = null;
}
